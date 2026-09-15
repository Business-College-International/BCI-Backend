import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, PaymentPurpose, PaymentStatus, RoleName } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { CreateFeeScheduleDto } from './dto/create-fee-schedule.dto';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

const PRIVILEGED_FINANCE_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
  RoleName.OFFICE,
]);

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async listFeeSchedules(termId: string, actorUserId: string, roles: RoleName[]) {
    this.assertFinanceReadScope(actorUserId, roles);
    return this.prisma.feeSchedule.findMany({
      where: { termId, isActive: true },
      orderBy: [{ level: 'asc' }, { programme: 'asc' }, { itemCode: 'asc' }],
    });
  }

  async createFeeSchedule(dto: CreateFeeScheduleDto, actorUserId: string) {
    const term = await this.prisma.term.findUnique({ where: { id: dto.termId } });
    if (!term) throw new NotFoundException('Term not found.');
    if (term.status === 'CLOSED') throw new BadRequestException('Cannot create an active fee schedule for a closed term.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const schedule = await tx.feeSchedule.create({
          data: {
            termId: dto.termId,
            level: dto.level,
            programme: dto.programme,
            itemCode: dto.itemCode.trim().toUpperCase(),
            itemName: dto.itemName.trim(),
            amount: dto.amount,
            isOptional: dto.isOptional ?? false,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'FeeSchedule',
            entityId: schedule.id,
            afterJson: {
              termId: schedule.termId,
              level: schedule.level,
              programme: schedule.programme,
              itemCode: schedule.itemCode,
              amount: schedule.amount.toString(),
            },
          },
        });

        return schedule;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('A fee item with that code already exists for the selected term, level and programme.');
      }
      throw error;
    }
  }

  async issueInvoice(dto: IssueInvoiceDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const [student, term, schedules] = await Promise.all([
        tx.student.findUnique({
          where: { id: dto.studentId },
          include: {
            enrolments: {
              where: { termId: dto.termId, status: 'ACTIVE' },
              take: 1,
            },
          },
        }),
        tx.term.findUnique({ where: { id: dto.termId } }),
        tx.feeSchedule.findMany({ where: { id: { in: dto.feeScheduleIds }, isActive: true } }),
      ]);

      if (!student) throw new NotFoundException('Student not found.');
      if (!term) throw new NotFoundException('Term not found.');
      if (student.status !== 'ACTIVE') throw new BadRequestException('Only active students can receive new invoices.');
      const enrolment = student.enrolments[0];
      if (!enrolment) throw new BadRequestException('Student has no active enrolment for the selected term.');
      if (schedules.length !== dto.feeScheduleIds.length) {
        throw new BadRequestException('One or more selected fee items are unavailable.');
      }

      for (const schedule of schedules) {
        if (
          schedule.termId !== dto.termId ||
          schedule.level !== enrolment.level ||
          schedule.programme !== enrolment.programme
        ) {
          throw new BadRequestException('A selected fee item does not match the student enrolment.');
        }
      }

      const existingOpen = await tx.studentInvoice.findFirst({
        where: { studentId: dto.studentId, termId: dto.termId, status: { in: [InvoiceStatus.OPEN, InvoiceStatus.PARTIALLY_PAID] } },
        include: { lines: true },
      });
      if (existingOpen) throw new ConflictException('An open invoice already exists for this student and term.');

      const invoiceNumber = await this.nextInvoiceNumber(tx);
      const invoice = await tx.studentInvoice.create({
        data: {
          studentId: dto.studentId,
          termId: dto.termId,
          invoiceNumber,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
          notes: dto.notes?.trim(),
          lines: {
            create: schedules.map((schedule) => ({
              feeScheduleId: schedule.id,
              description: schedule.itemName,
              amountDue: schedule.amount,
            })),
          },
        },
        include: { lines: true },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'StudentInvoice',
          entityId: invoice.id,
          afterJson: {
            studentId: invoice.studentId,
            termId: invoice.termId,
            invoiceNumber: invoice.invoiceNumber,
            lineCount: invoice.lines.length,
          },
        },
      });

      return this.toInvoiceView(invoice, []);
    });
  }

  async listStudentInvoices(studentId: string, actorUserId: string, roles: RoleName[]) {
    const scope = await this.resolveGuardianScope(studentId, actorUserId, roles);
    if (!scope.allowed) throw new ForbiddenException('You do not have access to this student\'s invoices.');
    if (scope.isGuardian && !scope.canPayFees) {
      throw new ForbiddenException('This guardian is not permitted to view or pay fees for this ward.');
    }

    const invoices = await this.prisma.studentInvoice.findMany({
      where: { studentId },
      include: { lines: true, allocations: true, term: { select: { code: true, name: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    return invoices.map((invoice) => this.toInvoiceView(invoice, invoice.allocations));
  }

  async createPaymentIntent(dto: CreatePaymentIntentDto, actorUserId: string, roles: RoleName[]) {
    const scope = await this.resolveInvoiceScope(dto.invoiceId, actorUserId, roles);
    if (!scope.allowed) throw new ForbiddenException('You do not have access to this invoice.');
    if (scope.isGuardian && !scope.canPayFees) {
      throw new ForbiddenException('This guardian is not permitted to make fee payments for this ward.');
    }

    const amount = new (require('@prisma/client').Prisma.Decimal)(dto.amount);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ invoiceId: dto.invoiceId, amount: amount.toFixed(2), clientReference: dto.clientReference ?? null }))
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_key_operation: { userId: actorUserId, key: dto.idempotencyKey, operation: 'create-payment-intent' } },
      });

      if (existingKey) {
        if (existingKey.requestHash !== requestHash) {
          throw new ConflictException('Idempotency key was already used for different payment data.');
        }
        if (existingKey.responseJson) return existingKey.responseJson;
      } else {
        await tx.idempotencyKey.create({
          data: {
            userId: actorUserId,
            key: dto.idempotencyKey,
            operation: 'create-payment-intent',
            requestHash,
          },
        });
      }

      const invoice = await tx.studentInvoice.findUnique({
        where: { id: dto.invoiceId },
        include: { lines: true, allocations: true },
      });
      if (!invoice) throw new NotFoundException('Invoice not found.');
      if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.VOID) {
        throw new ConflictException('This invoice cannot accept another payment.');
      }

      const invoiceTotal = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new (require('@prisma/client').Prisma.Decimal)(0));
      const allocatedTotal = invoice.allocations.reduce((sum, allocation) => sum.plus(allocation.amount), new (require('@prisma/client').Prisma.Decimal)(0));
      const outstanding = invoiceTotal.minus(allocatedTotal);
      if (amount.gt(outstanding)) {
        throw new BadRequestException('Payment amount exceeds the outstanding invoice balance.');
      }

      const payment = await tx.payment.create({
        data: {
          studentId: invoice.studentId,
          guardianId: scope.guardianPersonId ?? undefined,
          amount,
          purpose: PaymentPurpose.FEE,
          status: PaymentStatus.PENDING,
          clientReference: dto.clientReference?.trim(),
          idempotencyKey: dto.idempotencyKey,
        },
      });

      const response = {
        id: payment.id,
        invoiceId: invoice.id,
        amount: payment.amount.toString(),
        currency: payment.currency,
        purpose: payment.purpose,
        status: payment.status,
        clientReference: payment.clientReference,
      };

      await tx.idempotencyKey.update({
        where: { userId_key_operation: { userId: actorUserId, key: dto.idempotencyKey, operation: 'create-payment-intent' } },
        data: { responseJson: response, statusCode: 201, completedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'Payment',
          entityId: payment.id,
          afterJson: response,
        },
      });

      return response;
    });
  }

  private async resolveInvoiceScope(invoiceId: string, actorUserId: string, roles: RoleName) {
    throw new Error('unreachable');
  }

  private async resolveGuardianScope(studentId: string, actorUserId: string, roles: RoleName[] | RoleName) {
    const normalizedRoles = Array.isArray(roles) ? roles : [roles];
    if (normalizedRoles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) return { allowed: true, isGuardian: false };

    const guardian = await this.prisma.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!guardian) return { allowed: false, isGuardian: false };
    const link = await this.prisma.guardianStudent.findUnique({
      where: { guardianId_studentId: { guardianId: guardian.personId, studentId } },
      select: { canPayFees: true },
    });
    if (!link) return { allowed: false, isGuardian: true, canPayFees: false };
    return { allowed: true, isGuardian: true, canPayFees: link.canPayFees, guardianPersonId: guardian.personId };
  }

  private async assertFinanceReadScope(actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) return;
    throw new ForbiddenException('Finance access is restricted to authorized school personnel.');
  }

  private toInvoiceView(invoice: any, allocations: any[]) {
    const total = invoice.lines.reduce((sum: any, line: any) => sum.plus(line.amountDue), new (require('@prisma/client').Prisma.Decimal)(0));
    const allocated = allocations.reduce((sum: any, allocation: any) => sum.plus(allocation.amount), new (require('@prisma/client').Prisma.Decimal)(0));
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      studentId: invoice.studentId,
      termId: invoice.termId,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      notes: invoice.notes,
      totalAmount: total.toString(),
      amountAllocated: allocated.toString(),
      outstandingAmount: total.minus(allocated).toString(),
      lines: invoice.lines.map((line: any) => ({ id: line.id, description: line.description, amountDue: line.amountDue.toString() })),
    };
  }

  private async nextInvoiceNumber(tx: any) {
    const today = new Date();
    const prefix = `BCI-${today.getUTCFullYear()}-`;
    const latest = await tx.studentInvoice.findFirst({ where: { invoiceNumber: { startsWith: prefix } }, orderBy: { invoiceNumber: 'desc' }, select: { invoiceNumber: true } });
    const current = latest ? Number(latest.invoiceNumber.slice(prefix.length)) || 0 : 0;
    return `${prefix}${String(current + 1).padStart(6, '0')}`;
  }
}
