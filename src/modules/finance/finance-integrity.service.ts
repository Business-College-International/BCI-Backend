import { ForbiddenException, Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const PRIVILEGED_FINANCE_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
  RoleName.OFFICE,
]);

@Injectable()
export class FinanceIntegrityService {
  constructor(private readonly prisma: PrismaService) {}

  async getIntegrityReport(actorUserId: string, roles: RoleName[]) {
    if (!roles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) {
      throw new ForbiddenException(`Finance integrity access is restricted for user ${actorUserId}.`);
    }

    const [invoices, payments, allocations] = await Promise.all([
      this.prisma.studentInvoice.findMany({
        include: { lines: true },
        orderBy: { issuedAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        select: {
          id: true,
          status: true,
          amount: true,
          completedAt: true,
          receipt: { select: { id: true, receiptNumber: true } },
          refunds: { select: { amount: true, status: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.paymentAllocation.findMany({
        select: {
          id: true,
          paymentId: true,
          invoiceId: true,
          amount: true,
          payment: { select: { id: true, status: true, amount: true, refunds: { select: { amount: true, status: true } } } },
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      }),
    ]);

    const historicallySuccessfulPaymentIds = new Set(
      payments
        .filter((payment) => payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.REFUNDED)
        .map((payment) => payment.id),
    );
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));

    const allocationsByInvoice = new Map<string, Prisma.Decimal>();
    const orphanAllocations: Array<{ id: string; paymentId: string; invoiceId: string; amount: string }> = [];
    const invalidStatusAllocations: Array<{ id: string; paymentId: string; status: PaymentStatus; amount: string }> = [];
    const overAllocatedPayments: Array<{ paymentId: string; paymentAmount: string; allocatedAmount: string }> = [];
    const overRefundedPayments: Array<{ paymentId: string; paymentAmount: string; refundedAmount: string }> = [];

    for (const allocation of allocations) {
      if (!paymentById.has(allocation.paymentId)) {
        orphanAllocations.push({
          id: allocation.id,
          paymentId: allocation.paymentId,
          invoiceId: allocation.invoiceId,
          amount: allocation.amount.toFixed(2),
        });
      }

      if (!historicallySuccessfulPaymentIds.has(allocation.paymentId)) {
        invalidStatusAllocations.push({
          id: allocation.id,
          paymentId: allocation.paymentId,
          status: allocation.payment.status,
          amount: allocation.amount.toFixed(2),
        });
      }

      const refunded = allocation.payment.refunds
        .filter((refund) => refund.status === PaymentStatus.SUCCEEDED)
        .reduce((sum, refund) => sum.plus(refund.amount), new Prisma.Decimal(0));
      const net = Prisma.Decimal.max(allocation.amount.minus(refunded), 0);
      allocationsByInvoice.set(
        allocation.invoiceId,
        (allocationsByInvoice.get(allocation.invoiceId) ?? new Prisma.Decimal(0)).plus(net),
      );
    }

    const allocationsByPayment = new Map<string, Prisma.Decimal>();
    for (const allocation of allocations) {
      allocationsByPayment.set(
        allocation.paymentId,
        (allocationsByPayment.get(allocation.paymentId) ?? new Prisma.Decimal(0)).plus(allocation.amount),
      );
    }

    for (const payment of payments) {
      const allocated = allocationsByPayment.get(payment.id) ?? new Prisma.Decimal(0);
      if (allocated.gt(payment.amount)) {
        overAllocatedPayments.push({
          paymentId: payment.id,
          paymentAmount: payment.amount.toFixed(2),
          allocatedAmount: allocated.toFixed(2),
        });
      }
      const refunded = payment.refunds
        .filter((refund) => refund.status === PaymentStatus.SUCCEEDED)
        .reduce((sum, refund) => sum.plus(refund.amount), new Prisma.Decimal(0));
      if (refunded.gt(payment.amount)) {
        overRefundedPayments.push({
          paymentId: payment.id,
          paymentAmount: payment.amount.toFixed(2),
          refundedAmount: refunded.toFixed(2),
        });
      }
    }

    const statusMismatches = [] as Array<{
      invoiceId: string;
      invoiceNumber: string;
      storedStatus: InvoiceStatus;
      expectedStatus: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
      amountDue: string;
      succeededAllocated: string;
    }>;

    for (const invoice of invoices) {
      const amountDue = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
      const succeededAllocated = allocationsByInvoice.get(invoice.id) ?? new Prisma.Decimal(0);

      let expectedStatus: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' = 'OPEN';
      if (invoice.status === InvoiceStatus.VOID) {
        expectedStatus = 'VOID';
      } else if (succeededAllocated.gte(amountDue)) {
        expectedStatus = 'PAID';
      } else if (succeededAllocated.gt(0)) {
        expectedStatus = 'PARTIALLY_PAID';
      }

      if (invoice.status !== expectedStatus) {
        statusMismatches.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          storedStatus: invoice.status,
          expectedStatus,
          amountDue: amountDue.toFixed(2),
          succeededAllocated: succeededAllocated.toFixed(2),
        });
      }
    }

    const succeededWithoutReceipt = payments
      .filter((payment) => payment.status === PaymentStatus.SUCCEEDED && !payment.receipt)
      .map((payment) => ({
        paymentId: payment.id,
        amount: payment.amount.toFixed(2),
        completedAt: payment.completedAt,
      }));

    const totalInvoiceAmount = invoices.reduce(
      (sum, invoice) => sum.plus(invoice.lines.reduce((lineSum, line) => lineSum.plus(line.amountDue), new Prisma.Decimal(0))),
      new Prisma.Decimal(0),
    );
    const totalSucceededAllocated = Array.from(allocationsByInvoice.values()).reduce(
      (sum, value) => sum.plus(value),
      new Prisma.Decimal(0),
    );
    const totalSuccessfulRefunds = payments.reduce(
      (sum, payment) => sum.plus(payment.refunds
        .filter((refund) => refund.status === PaymentStatus.SUCCEEDED)
        .reduce((refundSum, refund) => refundSum.plus(refund.amount), new Prisma.Decimal(0))),
      new Prisma.Decimal(0),
    );

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        invoiceCount: invoices.length,
        paymentCount: payments.length,
        allocationCount: allocations.length,
        totalInvoiceAmount: totalInvoiceAmount.toFixed(2),
        totalSucceededAllocated: totalSucceededAllocated.toFixed(2),
        totalSuccessfulRefunds: totalSuccessfulRefunds.toFixed(2),
      },
      findings: {
        orphanAllocations,
        invalidStatusAllocations,
        overAllocatedPayments,
        overRefundedPayments,
        statusMismatches,
        succeededWithoutReceipt,
      },
      healthy:
        orphanAllocations.length === 0 &&
        invalidStatusAllocations.length === 0 &&
        overAllocatedPayments.length === 0 &&
        overRefundedPayments.length === 0 &&
        statusMismatches.length === 0 &&
        succeededWithoutReceipt.length === 0,
    };
  }
}
