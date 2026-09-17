import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { CreateFeeScheduleDto } from './dto/create-fee-schedule.dto';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { FinanceSummaryDto } from './dto/finance-summary.dto';

const PRIVILEGED_FINANCE_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
  RoleName.OFFICE,
]);

type InvoiceViewSource = {
  id: string;
  invoiceNumber: string;
  studentId: string;
  termId: string;
  status: InvoiceStatus;
  issuedAt: Date;
  dueAt: Date | null;
  notes: string | null;
  lines: Array<{ id: string; description: string; amountDue: Prisma.Decimal }>;
};

type InvoiceAllocation = {
  amount: Prisma.Decimal;
  payment?: { status: PaymentStatus };
};

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
    if (term.status === 'CLOSED') {
      throw new BadRequestException('Cannot create an active fee schedule for a closed term.');
    }

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
        throw new ConflictException(
          'A fee item with that code already exists for the selected term, level and programme.',
        );
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
        tx.feeSchedule.findMany({
          where: { id: { in: dto.feeScheduleIds }, isActive: true },
        }),
      ]);

      if (!student) throw new NotFoundException('Student not found.');
      if (!term) throw new NotFoundException('Term not found.');
      if (student.status !== 'ACTIVE') {
        throw new BadRequestException('Only active students can receive new invoices.');
      }
      if (term.status === 'CLOSED') {
        throw new BadRequestException('Invoices cannot be issued for a closed term.');
      }

      const enrolment = student.enrolments[0];
      if (!enrolment) {
        throw new BadRequestException('Student has no active enrolment for the selected term.');
      }
      if (schedules.length !== new Set(dto.feeScheduleIds).size) {
        throw new BadRequestException('Fee schedule identifiers must be unique.');
      }
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
        where: {
          studentId: dto.studentId,
          termId: dto.termId,
          status: { in: [InvoiceStatus.OPEN, InvoiceStatus.PARTIALLY_PAID] },
        },
        select: { id: true },
      });
      if (existingOpen) {
        throw new ConflictException('An open invoice already exists for this student and term.');
      }

      const invoiceNumber = this.nextInvoiceNumber();
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
    const scope = await this.resolveStudentFinanceScope(studentId, actorUserId, roles);
    if (!scope.allowed) {
      throw new ForbiddenException("You do not have access to this student's invoices.");
    }
    if (scope.isGuardian && !scope.canPayFees) {
      throw new ForbiddenException('This guardian is not permitted to view or pay fees for this ward.');
    }

    const invoices = await this.prisma.studentInvoice.findMany({
      where: { studentId },
      include: {
        lines: true,
        allocations: { include: { payment: { select: { status: true } } } },
      },
      orderBy: { issuedAt: 'desc' },
    });

    return invoices.map((invoice) => this.toInvoiceView(invoice, invoice.allocations));
  }

  async listStudentReceipts(studentId: string, actorUserId: string, roles: RoleName[]) {
    const scope = await this.resolveStudentFinanceScope(studentId, actorUserId, roles);
    if (!scope.allowed) throw new ForbiddenException("You do not have access to this student's payment history.");
    if (scope.isGuardian && !scope.canPayFees) {
      throw new ForbiddenException('This guardian is not permitted to view payment history for this ward.');
    }

    const payments = await this.prisma.payment.findMany({
      where: { studentId, status: 'SUCCEEDED' },
      include: {
        receipt: true,
        allocations: {
          include: {
            invoice: { select: { invoiceNumber: true, termId: true } },
          },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    return payments.map((payment) => ({
      paymentId: payment.id,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      purpose: payment.purpose,
      completedAt: payment.completedAt,
      provider: payment.provider,
      providerReference: payment.providerReference,
      receipt: payment.receipt
        ? {
            id: payment.receipt.id,
            receiptNumber: payment.receipt.receiptNumber,
            fileUrl: payment.receipt.fileUrl,
            issuedAt: payment.receipt.issuedAt,
          }
        : null,
      allocations: payment.allocations.map((allocation) => ({
        invoiceId: allocation.invoiceId,
        invoiceNumber: allocation.invoice.invoiceNumber,
        termId: allocation.invoice.termId,
        amount: allocation.amount.toFixed(2),
      })),
    }));
  }

  async getFinanceSummary(dto: FinanceSummaryDto, actorUserId: string, roles: RoleName[]) {
    this.assertFinanceReadScope(actorUserId, roles);
    const from = dto.from ? new Date(dto.from) : undefined;
    const to = dto.to ? new Date(dto.to) : undefined;
    if (from && to && from > to) throw new BadRequestException('The summary start date must not be after the end date.');

    const invoiceWhere: Prisma.StudentInvoiceWhereInput = {
      ...(dto.termId ? { termId: dto.termId } : {}),
      ...(from || to
        ? { issuedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    const invoices = await this.prisma.studentInvoice.findMany({
      where: invoiceWhere,
      include: { lines: true, allocations: { include: { payment: { select: { status: true } } } } },
    });

    const totals = invoices.reduce(
      (acc, invoice) => {
        const due = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
        const paid = invoice.allocations
          .filter((allocation) => allocation.payment.status === PaymentStatus.SUCCEEDED)
          .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
        acc.invoiced = acc.invoiced.plus(due);
        acc.paidAllocated = acc.paidAllocated.plus(paid);
        acc.outstanding = acc.outstanding.plus(due.minus(paid));
        acc[invoice.status] = (acc[invoice.status] ?? 0) + 1;
        return acc;
      },
      {
        invoiced: new Prisma.Decimal(0),
        paidAllocated: new Prisma.Decimal(0),
        outstanding: new Prisma.Decimal(0),
        OPEN: 0,
        PARTIALLY_PAID: 0,
        PAID: 0,
        VOID: 0,
      } as {
        invoiced: Prisma.Decimal;
        paidAllocated: Prisma.Decimal;
        outstanding: Prisma.Decimal;
        OPEN: number;
        PARTIALLY_PAID: number;
        PAID: number;
        VOID: number;
      },
    );

    const payments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED'] },
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
        ...(dto.termId ? { allocations: { some: { invoice: { termId: dto.termId } } } } : {}),
      },
      select: { status: true, amount: true },
    });

    const collected = payments
      .filter((payment) => payment.status === 'SUCCEEDED')
      .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
    const pending = payments
      .filter((payment) => payment.status === 'PENDING' || payment.status === 'PROCESSING')
      .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));

    return {
      filters: { termId: dto.termId ?? null, from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      invoices: {
        count: invoices.length,
        open: totals.OPEN as number,
        partiallyPaid: totals.PARTIALLY_PAID as number,
        paid: totals.PAID as number,
        void: totals.VOID as number,
        invoicedAmount: (totals.invoiced as Prisma.Decimal).toFixed(2),
        allocatedAmount: (totals.paidAllocated as Prisma.Decimal).toFixed(2),
        outstandingAmount: (totals.outstanding as Prisma.Decimal).toFixed(2),
      },
      payments: {
        collectedAmount: collected.toFixed(2),
        pendingAmount: pending.toFixed(2),
        totalPaymentRecords: payments.length,
      },
    };
  }

  private async resolveStudentFinanceScope(studentId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) {
      return { allowed: true, isGuardian: false, canPayFees: true };
    }

    const guardian = await this.prisma.guardian.findUnique({
      where: { userId: actorUserId },
      select: { personId: true },
    });
    if (!guardian) return { allowed: false, isGuardian: false, canPayFees: false };

    const link = await this.prisma.guardianStudent.findUnique({
      where: { guardianId_studentId: { guardianId: guardian.personId, studentId } },
      select: { canPayFees: true },
    });
    if (!link) return { allowed: false, isGuardian: true, canPayFees: false };

    return {
      allowed: true,
      isGuardian: true,
      canPayFees: link.canPayFees,
    };
  }

  private assertFinanceReadScope(actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) return;
    throw new ForbiddenException(`Finance access is restricted for user ${actorUserId}.`);
  }

  private toInvoiceView(invoice: InvoiceViewSource, allocations: InvoiceAllocation[]) {
    const total = invoice.lines.reduce(
      (sum, line) => sum.plus(line.amountDue),
      new Prisma.Decimal(0),
    );
    const allocated = allocations
      .filter((allocation) => allocation.payment?.status === PaymentStatus.SUCCEEDED)
      .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      studentId: invoice.studentId,
      termId: invoice.termId,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      notes: invoice.notes,
      totalAmount: total.toFixed(2),
      amountAllocated: allocated.toFixed(2),
      outstandingAmount: total.minus(allocated).toFixed(2),
      lines: invoice.lines.map((line) => ({
        id: line.id,
        description: line.description,
        amountDue: line.amountDue.toFixed(2),
      })),
    };
  }

  private nextInvoiceNumber() {
    const year = new Date().getUTCFullYear();
    return `BCI-${year}-${randomBytes(5).toString('hex').toUpperCase()}`;
  }
}
