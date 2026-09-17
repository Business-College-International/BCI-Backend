import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, PaymentPurpose, PaymentStatus, RoleName } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { MoolreAdapter } from '../payment-providers/moolre.adapter';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';

const PRIVILEGED_FINANCE_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
  RoleName.OFFICE,
]);

@Injectable()
export class PaymentInitiationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moolre: MoolreAdapter,
  ) {}

  async initiate(
    studentId: string,
    dto: InitiatePaymentDto,
    actorUserId: string,
    roles: RoleName[],
    idempotencyKey: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new ConflictException('An Idempotency-Key header is required for payment initiation.');
    }

    const uniqueInvoiceIds = [...new Set(dto.invoiceIds)];
    if (uniqueInvoiceIds.length !== dto.invoiceIds.length) {
      throw new ConflictException('Invoice identifiers must be unique.');
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify({
        studentId,
        invoiceIds: uniqueInvoiceIds,
        amount: dto.amount ?? null,
        network: dto.network?.trim().toUpperCase() ?? null,
        callbackUrl: dto.callbackUrl ?? null,
      }))
      .digest('hex');

    const reservation = await this.reserve(
      studentId,
      dto,
      actorUserId,
      roles,
      idempotencyKey.trim(),
      requestHash,
    );

    if ('existing' in reservation) return reservation.existing;

    try {
      const providerResult = await this.moolre.initiatePayment({
        clientReference: reservation.payment.clientReference!,
        amount: reservation.payment.amount.toFixed(2),
        currency: reservation.payment.currency,
        purpose: PaymentPurpose.FEE,
        callbackUrl: dto.callbackUrl ?? '',
        customer: reservation.customer,
      });

      const status = PaymentStatus.PROCESSING;
      const updated = await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.update({
          where: { id: reservation.payment.id },
          data: {
            status,
            provider: this.moolre.provider,
            providerReference: providerResult.providerReference,
          },
        });

        await tx.paymentProviderAttempt.update({
          where: { id: reservation.attemptId },
          data: {
            status,
            providerReference: providerResult.providerReference,
            responsePayload: {
              providerReference: providerResult.providerReference,
              requiresOtp: providerResult.requiresOtp,
              mock: providerResult.mock,
            },
          },
        });

        const response = {
          paymentId: payment.id,
          clientReference: payment.clientReference,
          status: payment.status,
          amount: payment.amount.toFixed(2),
          currency: payment.currency,
          provider: this.moolre.provider,
          providerReference: providerResult.providerReference,
          requiresOtp: providerResult.requiresOtp,
          mock: providerResult.mock,
          allocations: reservation.allocations,
        };

        await tx.idempotencyKey.update({
          where: { userId_key_operation: { userId: actorUserId, key: idempotencyKey.trim(), operation: 'payments.initiate' } },
          data: {
            responseJson: response,
            statusCode: 202,
            completedAt: new Date(),
          },
        });

        return response;
      });

      return updated;
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        const failedAt = new Date();
        await tx.payment.update({
          where: { id: reservation.payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureCode: 'PROVIDER_INITIATION_FAILED',
            failureMessage: error instanceof Error ? error.message : 'Payment provider initiation failed.',
            completedAt: failedAt,
          },
        });
        await tx.paymentProviderAttempt.update({
          where: { id: reservation.attemptId },
          data: {
            status: PaymentStatus.FAILED,
            resolvedAt: failedAt,
            failureCode: 'PROVIDER_INITIATION_FAILED',
            failureMessage: error instanceof Error ? error.message : 'Payment provider initiation failed.',
          },
        });
        await tx.idempotencyKey.update({
          where: { userId_key_operation: { userId: actorUserId, key: idempotencyKey.trim(), operation: 'payments.initiate' } },
          data: {
            responseJson: { paymentId: reservation.payment.id, status: PaymentStatus.FAILED },
            statusCode: 503,
            completedAt: failedAt,
          },
        });
      });

      throw new ServiceUnavailableException('Payment provider initiation failed; no funds were captured.');
    }
  }

  private async reserve(
    studentId: string,
    dto: InitiatePaymentDto,
    actorUserId: string,
    roles: RoleName[],
    idempotencyKey: string,
    requestHash: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingKey = await tx.idempotencyKey.findUnique({
          where: { userId_key_operation: { userId: actorUserId, key: idempotencyKey, operation: 'payments.initiate' } },
        });
        if (existingKey) {
          if (existingKey.requestHash !== requestHash) {
            throw new ConflictException('The idempotency key was already used with a different payment request.');
          }
          if (!existingKey.responseJson) {
            throw new ConflictException('An identical payment initiation is already in progress.');
          }
          return { existing: existingKey.responseJson as Record<string, unknown> };
        }

        const guardian = await this.resolveCustomer(tx, studentId, actorUserId, roles, dto.network);
        await this.assertFinanceAccess(tx, studentId, actorUserId, roles);

        await tx.$executeRaw`
          SELECT id FROM "StudentInvoice"
          WHERE "studentId" = ${studentId}
            AND id IN (${Prisma.join(dto.invoiceIds)})
          FOR UPDATE
        `;

        const invoices = await tx.studentInvoice.findMany({
          where: {
            id: { in: dto.invoiceIds },
            studentId,
            status: { in: ['OPEN', 'PARTIALLY_PAID'] },
          },
          include: {
            lines: true,
            allocations: { include: { payment: { select: { status: true } } } },
          },
          orderBy: [{ dueAt: 'asc' }, { issuedAt: 'asc' }],
        });

        if (invoices.length !== dto.invoiceIds.length) {
          throw new ConflictException('One or more selected invoices are unavailable for payment.');
        }

        const availableByInvoice = invoices.map((invoice) => {
          const due = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
          const settled = invoice.allocations
            .filter((allocation) => allocation.payment.status === PaymentStatus.SUCCEEDED)
            .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
          const reserved = invoice.allocations
            .filter((allocation) => allocation.payment.status === PaymentStatus.PENDING || allocation.payment.status === PaymentStatus.PROCESSING)
            .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
          return { invoice, available: due.minus(settled).minus(reserved) };
        });

        if (availableByInvoice.some((item) => item.available.lte(0))) {
          throw new ConflictException('One or more selected invoices are already fully reserved by another payment attempt.');
        }

        const availableOutstanding = availableByInvoice.reduce((sum, item) => sum.plus(Prisma.Decimal.max(item.available, 0)), new Prisma.Decimal(0));
        const requestedAmount = dto.amount ? new Prisma.Decimal(dto.amount) : availableOutstanding;
        if (requestedAmount.lte(0) || requestedAmount.gt(availableOutstanding)) {
          throw new ConflictException('Payment amount exceeds the currently available invoice balance.');
        }

        const clientReference = `bci-${randomBytes(12).toString('hex')}`;
        const payment = await tx.payment.create({
          data: {
            studentId,
            guardianId: guardian.personId,
            amount: requestedAmount,
            purpose: PaymentPurpose.FEE,
            status: PaymentStatus.PENDING,
            clientReference,
            idempotencyKey,
          },
        });

        let remaining = requestedAmount;
        const allocations: Array<{ invoiceId: string; invoiceNumber: string; amount: string }> = [];
        for (const item of availableByInvoice) {
          if (remaining.lte(0)) break;
          const amount = Prisma.Decimal.min(remaining, item.available);
          await tx.paymentAllocation.create({
            data: { paymentId: payment.id, invoiceId: item.invoice.id, amount },
          });
          allocations.push({
            invoiceId: item.invoice.id,
            invoiceNumber: item.invoice.invoiceNumber,
            amount: amount.toFixed(2),
          });
          remaining = remaining.minus(amount);
        }

        const attempt = await tx.paymentProviderAttempt.create({
          data: {
            paymentId: payment.id,
            provider: this.moolre.provider,
            status: PaymentStatus.PENDING,
          },
        });

        await tx.idempotencyKey.create({
          data: {
            userId: actorUserId,
            key: idempotencyKey,
            operation: 'payments.initiate',
            requestHash,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'Payment',
            entityId: payment.id,
            afterJson: {
              status: payment.status,
              amount: payment.amount.toFixed(2),
              purpose: payment.purpose,
              clientReference: payment.clientReference,
              reservation: true,
              allocations,
            },
          },
        });

        return {
          payment,
          attemptId: attempt.id,
          allocations,
          customer: guardian,
        };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.idempotencyKey.findUnique({
          where: { userId_key_operation: { userId: actorUserId, key: idempotencyKey, operation: 'payments.initiate' } },
        });
        if (existing?.requestHash !== requestHash) {
          throw new ConflictException('The idempotency key was already used with a different payment request.');
        }
        if (!existing?.responseJson) throw new ConflictException('An identical payment initiation is already in progress.');
        return { existing: existing.responseJson as Record<string, unknown> };
      }
      throw error;
    }
  }

  private async assertFinanceAccess(tx: Prisma.TransactionClient, studentId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) return;
    const guardian = await tx.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!guardian) throw new ForbiddenException('You do not have permission to pay fees for this student.');
    const link = await tx.guardianStudent.findUnique({
      where: { guardianId_studentId: { guardianId: guardian.personId, studentId } },
      select: { canPayFees: true },
    });
    if (!link?.canPayFees) throw new ForbiddenException('This guardian is not permitted to pay fees for this ward.');
  }

  private async resolveCustomer(tx: Prisma.TransactionClient, studentId: string, actorUserId: string, roles: RoleName[], network?: string) {
    let personId: string | null = null;
    if (!roles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) {
      const guardian = await tx.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
      personId = guardian?.personId ?? null;
    } else {
      const link = await tx.guardianStudent.findFirst({
        where: { studentId, isPrimaryContact: true },
        select: { guardianId: true },
      });
      personId = link?.guardianId ?? null;
      if (!personId) {
        const fallback = await tx.guardianStudent.findFirst({ where: { studentId }, select: { guardianId: true } });
        personId = fallback?.guardianId ?? null;
      }
    }

    if (!personId) throw new NotFoundException('A guardian contact is required before initiating a fee payment.');
    const person = await tx.person.findUnique({ where: { id: personId }, select: { id: true, firstName: true, lastName: true, phone: true } });
    if (!person?.phone) throw new ConflictException('A guardian phone number is required before initiating a fee payment.');
    return {
      personId: person.id,
      name: `${person.firstName} ${person.lastName}`.trim(),
      phone: person.phone,
      ...(network?.trim() ? { network: network.trim().toUpperCase() } : {}),
    };
  }
}
