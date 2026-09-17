import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentPurpose, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { MoolreAdapter } from '../payment-providers/moolre.adapter';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';

const PRIVILEGED_FINANCE_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.ACCOUNTANT]);
const IDEMPOTENCY_OPERATION = 'PAYMENT_INITIATE';
const ACTIVE_PAYMENT_STATUSES: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED];

@Injectable()
export class PaymentService {
  constructor(private readonly prisma: PrismaService, private readonly provider: MoolreAdapter) {}

  async initiate(studentId: string, dto: InitiatePaymentDto, actorUserId: string, roles: RoleName[]) {
    const scope = await this.resolveScope(studentId, actorUserId, roles);
    if (!scope.allowed) throw new ForbiddenException('You do not have permission to initiate a payment for this student.');

    const invoiceIds = [...new Set(dto.invoiceIds)].sort();
    if (invoiceIds.length !== dto.invoiceIds.length) throw new BadRequestException('Invoice identifiers must be unique.');
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Payment amount must be greater than zero.');

    const requestHash = this.hashRequest({
      studentId,
      amount: amount.toFixed(2),
      invoiceIds,
      customerName: dto.customerName?.trim() ?? null,
      customerPhone: dto.customerPhone?.trim() ?? null,
      network: dto.network?.toUpperCase() ?? null,
      callbackUrl: dto.callbackUrl.trim(),
    });

    const prepared = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext(concat('bci:payment-initiation:', ${studentId}, ':', ${actorUserId}, ':', ${dto.idempotencyKey}))
        )
      `;

      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_key_operation: { userId: actorUserId, key: dto.idempotencyKey, operation: IDEMPOTENCY_OPERATION } },
      });
      if (existingKey) {
        if (existingKey.requestHash !== requestHash) throw new ConflictException('This idempotency key was already used with a different payment request.');
        if (existingKey.responseJson) return existingKey.responseJson as Record<string, unknown>;
        throw new ConflictException('A payment with this idempotency key is already being created.');
      }

      const invoices = await tx.studentInvoice.findMany({
        where: { id: { in: invoiceIds }, studentId, status: { in: [InvoiceStatus.OPEN, InvoiceStatus.PARTIALLY_PAID] } },
        include: { lines: true, allocations: { include: { payment: { select: { status: true } } } } },
        orderBy: [{ dueAt: 'asc' }, { issuedAt: 'asc' }],
      });
      if (invoices.length !== invoiceIds.length) throw new BadRequestException('One or more selected invoices are missing, closed, or belong to another student.');

      const invoiceBalances = invoices.map((invoice) => {
        const due = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
        const reservedOrPaid = invoice.allocations
          .filter((allocation) => ACTIVE_PAYMENT_STATUSES.includes(allocation.payment.status))
          .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
        return { invoice, outstanding: due.minus(reservedOrPaid) };
      });

      if (invoiceBalances.some((item) => item.outstanding.lte(0))) throw new ConflictException('One or more selected invoices have no remaining balance available for reservation.');
      const available = invoiceBalances.reduce((sum, item) => sum.plus(item.outstanding), new Prisma.Decimal(0));
      if (amount.gt(available)) throw new BadRequestException('Payment amount exceeds the remaining invoice balance after active reservations.');

      const payment = await tx.payment.create({
        data: {
          studentId,
          guardianId: scope.guardianId,
          amount,
          currency: 'GHS',
          purpose: PaymentPurpose.FEE,
          status: PaymentStatus.PENDING,
          idempotencyKey: dto.idempotencyKey,
          allocations: { create: this.buildAllocations(invoiceBalances, amount) },
        },
        include: { allocations: true },
      });
      const clientReference = `BCI-${payment.id}`;
      await tx.payment.update({ where: { id: payment.id }, data: { clientReference } });
      await tx.paymentProviderAttempt.create({
        data: {
          paymentId: payment.id,
          provider: this.provider.provider,
          status: PaymentStatus.PENDING,
          requestPayload: { invoiceIds, amount: amount.toFixed(2), currency: 'GHS', clientReference },
        },
      });

      const response = {
        paymentId: payment.id,
        clientReference,
        status: PaymentStatus.PENDING,
        amount: amount.toFixed(2),
        currency: 'GHS',
        allocations: payment.allocations.map((allocation) => ({ invoiceId: allocation.invoiceId, amount: allocation.amount.toFixed(2) })),
      };
      await tx.idempotencyKey.create({
        data: {
          userId: actorUserId,
          key: dto.idempotencyKey,
          operation: IDEMPOTENCY_OPERATION,
          requestHash,
          responseJson: response,
          statusCode: 201,
          completedAt: new Date(),
        },
      });
      return response;
    });

    try {
      const customer = await this.resolveCustomer(studentId, actorUserId, dto);
      const providerResult = await this.provider.initiatePayment({
        clientReference: prepared.clientReference as string,
        amount: prepared.amount as string,
        currency: 'GHS',
        purpose: 'FEE',
        callbackUrl: dto.callbackUrl.trim(),
        customer,
      });
      const nextStatus = providerResult.requiresOtp || providerResult.providerReference ? PaymentStatus.PROCESSING : PaymentStatus.PENDING;
      const finalResponse = { ...prepared, status: nextStatus, providerReference: providerResult.providerReference, requiresOtp: providerResult.requiresOtp, mock: providerResult.mock };

      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: prepared.paymentId as string }, data: { status: nextStatus, providerReference: providerResult.providerReference ?? undefined } });
        await tx.paymentProviderAttempt.updateMany({
          where: { paymentId: prepared.paymentId as string, provider: this.provider.provider },
          data: { status: nextStatus, providerReference: providerResult.providerReference, responsePayload: providerResult },
        });
        await tx.idempotencyKey.update({
          where: { userId_key_operation: { userId: actorUserId, key: dto.idempotencyKey, operation: IDEMPOTENCY_OPERATION } },
          data: { responseJson: finalResponse },
        });
      });
      return finalResponse;
    } catch (error) {
      if (error instanceof BadRequestException) await this.failReservation(prepared.paymentId as string, actorUserId, dto.idempotencyKey, error.message);
      else await this.markProviderUncertain(prepared.paymentId as string, actorUserId, dto.idempotencyKey, error);
      throw error;
    }
  }

  private async failReservation(paymentId: string, userId: string, idempotencyKey: string, message: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.FAILED, failureMessage: message, completedAt: new Date() } });
      await tx.paymentAllocation.deleteMany({ where: { paymentId } });
      await tx.paymentProviderAttempt.updateMany({ where: { paymentId }, data: { status: PaymentStatus.FAILED, resolvedAt: new Date(), failureMessage: message } });
      await tx.idempotencyKey.update({
        where: { userId_key_operation: { userId, key: idempotencyKey, operation: IDEMPOTENCY_OPERATION } },
        data: { responseJson: { paymentId, status: PaymentStatus.FAILED, failureMessage: message } },
      });
    });
  }

  private async markProviderUncertain(paymentId: string, userId: string, idempotencyKey: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'Provider initiation outcome is unknown.';
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { status: PaymentStatus.PROCESSING, failureMessage: message } });
      await tx.paymentProviderAttempt.updateMany({ where: { paymentId }, data: { status: PaymentStatus.PROCESSING, failureMessage: message } });
      await tx.idempotencyKey.update({
        where: { userId_key_operation: { userId, key: idempotencyKey, operation: IDEMPOTENCY_OPERATION } },
        data: { responseJson: { paymentId, status: PaymentStatus.PROCESSING, providerOutcome: 'UNKNOWN' } },
      });
    });
  }

  private async resolveCustomer(studentId: string, actorUserId: string, dto: InitiatePaymentDto) {
    if (dto.customerPhone && dto.customerName) return { name: dto.customerName.trim(), phone: dto.customerPhone.trim(), network: dto.network?.toUpperCase() };
    const guardian = await this.prisma.guardian.findUnique({ where: { userId: actorUserId }, select: { person: { select: { firstName: true, lastName: true, phone: true } } } });
    if (!guardian?.person.phone) {
      const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true } });
      throw new BadRequestException(`A customer phone number is required to initiate a payment for ${student ? `${student.firstName} ${student.lastName}` : 'this student'}.`);
    }
    return {
      name: dto.customerName?.trim() || `${guardian.person.firstName} ${guardian.person.lastName}`.trim(),
      phone: dto.customerPhone?.trim() || guardian.person.phone,
      network: dto.network?.toUpperCase(),
    };
  }

  private buildAllocations(invoiceBalances: Array<{ invoice: { id: string }; outstanding: Prisma.Decimal }>, requestedAmount: Prisma.Decimal) {
    let remaining = requestedAmount;
    return invoiceBalances.flatMap((item) => {
      if (remaining.lte(0)) return [];
      const allocation = Prisma.Decimal.min(remaining, item.outstanding);
      remaining = remaining.minus(allocation);
      return [{ invoiceId: item.invoice.id, amount: allocation }];
    });
  }

  private async resolveScope(studentId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) {
      const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found.');
      return { allowed: true, guardianId: null };
    }
    const guardian = await this.prisma.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!guardian) return { allowed: false, guardianId: null };
    const link = await this.prisma.guardianStudent.findUnique({ where: { guardianId_studentId: { guardianId: guardian.personId, studentId } }, select: { canPayFees: true } });
    return { allowed: Boolean(link?.canPayFees), guardianId: guardian.personId };
  }

  private hashRequest(input: unknown) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }
}
