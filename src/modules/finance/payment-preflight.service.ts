import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { PaymentPreflightDto } from './dto/payment-preflight.dto';

const PRIVILEGED_FINANCE_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
  RoleName.OFFICE,
]);
const RESERVED_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.PENDING,
  PaymentStatus.PROCESSING,
  PaymentStatus.SUCCEEDED,
]);

@Injectable()
export class PaymentPreflightService {
  constructor(private readonly prisma: PrismaService) {}

  async preflight(studentId: string, dto: PaymentPreflightDto, actorUserId: string, roles: RoleName[]) {
    const allowed = await this.canAccessStudentFinance(studentId, actorUserId, roles);
    if (!allowed) throw new ForbiddenException('You do not have permission to prepare a payment for this student.');

    const uniqueInvoiceIds = [...new Set(dto.invoiceIds)];
    if (uniqueInvoiceIds.length !== dto.invoiceIds.length) throw new BadRequestException('Invoice identifiers must be unique.');

    const invoices = await this.prisma.studentInvoice.findMany({
      where: { id: { in: uniqueInvoiceIds }, studentId, status: { in: [InvoiceStatus.OPEN, InvoiceStatus.PARTIALLY_PAID] } },
      include: { lines: true, allocations: { include: { payment: { select: { status: true } } } }, term: { select: { id: true, code: true, name: true } } },
      orderBy: [{ dueAt: 'asc' }, { issuedAt: 'asc' }],
    });
    if (invoices.length !== uniqueInvoiceIds.length) throw new BadRequestException('One or more selected invoices are missing, paid, void, or belong to another student.');

    const outstandingInvoices = invoices.map((invoice) => {
      const due = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
      const reservedOrPaid = invoice.allocations
        .filter((allocation) => RESERVED_PAYMENT_STATUSES.has(allocation.payment.status))
        .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
      return { invoice, total: due, outstanding: due.minus(reservedOrPaid) };
    });

    if (outstandingInvoices.some((item) => item.outstanding.lte(0))) throw new BadRequestException('One or more selected invoices do not have an available balance.');
    const availableOutstanding = outstandingInvoices.reduce((sum, item) => sum.plus(item.outstanding), new Prisma.Decimal(0));
    const requestedAmount = dto.amount ? new Prisma.Decimal(dto.amount) : availableOutstanding;
    if (requestedAmount.lte(0)) throw new BadRequestException('Payment amount must be greater than zero.');
    if (requestedAmount.gt(availableOutstanding)) throw new BadRequestException('Payment amount exceeds the currently available invoice balance.');

    let remaining = requestedAmount;
    const allocations: Array<{ invoiceId: string; invoiceNumber: string; termId: string; amount: string }> = [];
    for (const item of outstandingInvoices) {
      if (remaining.lte(0)) break;
      const allocation = Prisma.Decimal.min(remaining, item.outstanding);
      allocations.push({ invoiceId: item.invoice.id, invoiceNumber: item.invoice.invoiceNumber, termId: item.invoice.termId, amount: allocation.toFixed(2) });
      remaining = remaining.minus(allocation);
    }

    const pendingPayments = await this.prisma.payment.findMany({
      where: { studentId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },
      select: { id: true, amount: true, status: true, createdAt: true, clientReference: true },
      orderBy: { createdAt: 'desc' },
    });
    const pendingAmount = pendingPayments.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));

    return {
      studentId,
      requestedAmount: requestedAmount.toFixed(2),
      selectedOutstandingAmount: availableOutstanding.toFixed(2),
      allocations,
      pendingPayments: {
        count: pendingPayments.length,
        amount: pendingAmount.toFixed(2),
        items: pendingPayments.map((payment) => ({ id: payment.id, amount: payment.amount.toFixed(2), status: payment.status, createdAt: payment.createdAt, clientReference: payment.clientReference })),
      },
      reservation: {
        available: true,
        durable: true,
        requiredBeforeProviderInitiation: true,
        mechanism: 'PENDING/PROCESSING payment allocations are durable invoice reservations and are released on provider failure/cancellation.',
      },
    };
  }

  private async canAccessStudentFinance(studentId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) return true;
    const guardian = await this.prisma.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!guardian) return false;
    const link = await this.prisma.guardianStudent.findUnique({ where: { guardianId_studentId: { guardianId: guardian.personId, studentId } }, select: { canPayFees: true } });
    if (!link?.canPayFees) return false;
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) throw new NotFoundException('Student not found.');
    return true;
  }
}
