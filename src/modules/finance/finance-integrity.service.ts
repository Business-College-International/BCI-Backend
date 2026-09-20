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

    const [invoices, payments, allocations, walletTransactions, stationeryOrders, journalEntries] = await Promise.all([
      this.prisma.studentInvoice.findMany({
        include: { lines: true },
        orderBy: { issuedAt: 'asc' },
      }),
      this.prisma.payment.findMany({
        select: {
          id: true,
          studentId: true,
          guardianId: true,
          purpose: true,
          status: true,
          amount: true,
          completedAt: true,
          receipt: { select: { id: true, receiptNumber: true } },
          refunds: { select: { id: true, amount: true, status: true } },
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
      this.prisma.walletTransaction.findMany({
        select: {
          id: true,
          walletId: true,
          type: true,
          direction: true,
          amount: true,
          paymentId: true,
          reversalOfId: true,
          payment: {
            select: {
              id: true,
              studentId: true,
              amount: true,
              currency: true,
              purpose: true,
              status: true,
            },
          },
          reversalOf: {
            select: {
              id: true,
              walletId: true,
              type: true,
              direction: true,
              amount: true,
              paymentId: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.stationeryOrder.findMany({
        select: {
          id: true,
          orderNumber: true,
          studentId: true,
          guardianId: true,
          status: true,
          totalAmount: true,
          paymentId: true,
        },
        orderBy: { orderedAt: 'asc' },
      }),
      this.prisma.financialJournalEntry.findMany({
        where: {
          referenceType: { in: ['Payment', 'Refund'] },
        },
        select: {
          id: true,
          entryNumber: true,
          accountCode: true,
          direction: true,
          amount: true,
          currency: true,
          referenceType: true,
          referenceId: true,
          transactionAt: true,
        },
        orderBy: [{ referenceType: 'asc' }, { referenceId: 'asc' }, { transactionAt: 'asc' }],
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

    const journalByReference = new Map<string, typeof journalEntries>();
    for (const entry of journalEntries) {
      const key = `${entry.referenceType}:${entry.referenceId}`;
      const existing = journalByReference.get(key) ?? [];
      existing.push(entry);
      journalByReference.set(key, existing);
    }

    const unbalancedJournalTransactions: Array<{
      referenceType: string;
      referenceId: string;
      entryNumbers: string[];
      debit: string;
      credit: string;
    }> = [];

    for (const [key, entries] of journalByReference) {
      const debit = entries
        .filter((entry) => entry.direction === 'DEBIT')
        .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
      const credit = entries
        .filter((entry) => entry.direction === 'CREDIT')
        .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
      const entryNumbers = [...new Set(entries.map((entry) => entry.entryNumber))];
      const currencies = new Set(entries.map((entry) => entry.currency));

      if (
        entries.length < 2 ||
        !debit.eq(credit) ||
        currencies.size !== 1 ||
        entryNumbers.length !== 1
      ) {
        const separator = key.indexOf(':');
        unbalancedJournalTransactions.push({
          referenceType: key.slice(0, separator),
          referenceId: key.slice(separator + 1),
          entryNumbers,
          debit: debit.toFixed(2),
          credit: credit.toFixed(2),
        });
      }
    }

    const missingPaymentJournalEntries = payments
      .filter((payment) =>
        (payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.REFUNDED) &&
        ['FEE', 'WALLET_TOP_UP', 'STATIONERY'].includes(payment.purpose),
      )
      .filter((payment) => !journalByReference.has(`Payment:${payment.id}`))
      .map((payment) => ({
        paymentId: payment.id,
        purpose: payment.purpose,
        amount: payment.amount.toFixed(2),
      }));

    const missingRefundJournalEntries = payments
      .flatMap((payment) =>
        payment.refunds
          .filter((refund) => refund.status === PaymentStatus.SUCCEEDED)
          .map((refund) => ({
            paymentId: payment.id,
            refundId: refund.id,
            amount: refund.amount,
          })),
      )
      .filter((refund) => !journalByReference.has(`Refund:${refund.refundId}`))
      .map((refund) => ({
        paymentId: refund.paymentId,
        refundId: refund.refundId,
        amount: refund.amount.toFixed(2),
      }));

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

    const orphanWalletPaymentLinks: Array<{ transactionId: string; paymentId: string }> = [];
    const invalidWalletPaymentLinks: Array<{ transactionId: string; paymentId: string; reason: string }> = [];
    const invalidWalletDirections: Array<{ transactionId: string; type: string; direction: string | null }> = [];
    const invalidWalletReversals: Array<{ transactionId: string; reversalOfId: string | null; reason: string }> = [];
    const walletBalanceByStudent = new Map<string, Prisma.Decimal>();

    for (const transaction of walletTransactions) {
      const current = walletBalanceByStudent.get(transaction.walletId) ?? new Prisma.Decimal(0);
      if (transaction.direction === 'CREDIT') {
        walletBalanceByStudent.set(transaction.walletId, current.plus(transaction.amount));
      } else if (transaction.direction === 'DEBIT') {
        walletBalanceByStudent.set(transaction.walletId, current.minus(transaction.amount));
      }

      if (transaction.paymentId) {
        if (!transaction.payment) {
          orphanWalletPaymentLinks.push({ transactionId: transaction.id, paymentId: transaction.paymentId });
        } else {
          if (transaction.payment.purpose !== 'WALLET_TOP_UP') {
            invalidWalletPaymentLinks.push({
              transactionId: transaction.id,
              paymentId: transaction.payment.id,
              reason: 'Wallet transaction references a non-wallet payment.',
            });
          }
          if (
            transaction.payment.studentId !== transaction.walletId ||
            !transaction.amount.eq(transaction.payment.amount) ||
            transaction.type !== 'TOP_UP'
          ) {
            invalidWalletPaymentLinks.push({
              transactionId: transaction.id,
              paymentId: transaction.payment.id,
              reason: 'Wallet top-up does not match the linked payment student, amount, or transaction type.',
            });
          }
          if (transaction.payment.status !== PaymentStatus.SUCCEEDED && transaction.payment.status !== PaymentStatus.REFUNDED) {
            invalidWalletPaymentLinks.push({
              transactionId: transaction.id,
              paymentId: transaction.payment.id,
              reason: 'Wallet credit is linked to a payment that has not reached a successful terminal state.',
            });
          }
        }
      }

      if (
        (transaction.type === 'TOP_UP' && transaction.direction !== 'CREDIT') ||
        (transaction.type === 'WITHDRAWAL' && transaction.direction !== 'DEBIT') ||
        (transaction.type === 'REVERSAL' && !transaction.direction)
      ) {
        invalidWalletDirections.push({
          transactionId: transaction.id,
          type: transaction.type,
          direction: transaction.direction,
        });
      }

      if (transaction.type === 'REVERSAL') {
        if (!transaction.reversalOf) {
          invalidWalletReversals.push({
            transactionId: transaction.id,
            reversalOfId: transaction.reversalOfId,
            reason: 'Reversal does not identify an original transaction.',
          });
        } else if (
          transaction.reversalOf.walletId !== transaction.walletId ||
          transaction.reversalOf.type === 'REVERSAL' ||
          !transaction.reversalOf.amount.eq(transaction.amount) ||
          transaction.reversalOf.direction === transaction.direction
        ) {
          invalidWalletReversals.push({
            transactionId: transaction.id,
            reversalOfId: transaction.reversalOf.id,
            reason: 'Reversal does not mirror the original wallet transaction.',
          });
        }
      }
    }

    const walletPaymentIds = new Set(
      walletTransactions.filter((transaction) => transaction.paymentId).map((transaction) => transaction.paymentId as string),
    );
    const successfulWalletTopUpsWithoutLedger = payments
      .filter((payment) =>
        payment.status === PaymentStatus.SUCCEEDED &&
        payment.purpose === 'WALLET_TOP_UP' &&
        !walletPaymentIds.has(payment.id),
      )
      .map((payment) => ({
        paymentId: payment.id,
        studentId: payment.studentId,
        amount: payment.amount.toFixed(2),
      }));

    const negativeWalletBalances = Array.from(walletBalanceByStudent.entries())
      .filter(([, balance]) => balance.lt(0))
      .map(([studentId, balance]) => ({ studentId, balance: balance.toFixed(2) }));

    const stationeryOrdersByPayment = new Map<string, typeof stationeryOrders>();
    const successfulStationeryPaymentsWithoutOrder: Array<{
      paymentId: string;
      studentId: string | null;
      amount: string;
    }> = [];
    const invalidStationeryPaymentLinks: Array<{
      orderId: string;
      orderNumber: string;
      paymentId: string | null;
      reason: string;
    }> = [];

    for (const order of stationeryOrders) {
      if (order.paymentId) {
        const existingOrders = stationeryOrdersByPayment.get(order.paymentId) ?? [];
        existingOrders.push(order);
        stationeryOrdersByPayment.set(order.paymentId, existingOrders);
      }

      if (['PAID', 'READY_FOR_COLLECTION', 'COLLECTED'].includes(order.status)) {
        const payment = order.paymentId ? paymentById.get(order.paymentId) : null;
        if (!payment) {
          invalidStationeryPaymentLinks.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            paymentId: order.paymentId,
            reason: 'Fulfillable stationery order has no linked payment.',
          });
        } else if (
          payment.status !== PaymentStatus.SUCCEEDED ||
          payment.purpose !== 'STATIONERY' ||
          payment.studentId !== order.studentId ||
          payment.guardianId !== order.guardianId ||
          !payment.amount.eq(order.totalAmount)
        ) {
          invalidStationeryPaymentLinks.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            paymentId: payment.id,
            reason: 'Stationery order does not match the linked successful STATIONERY payment identity or amount.',
          });
        }
      }
    }

    for (const payment of payments) {
      if (payment.purpose !== 'STATIONERY') continue;
      const linkedOrders = stationeryOrdersByPayment.get(payment.id) ?? [];
      if (
        (payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.REFUNDED) &&
        linkedOrders.length === 0
      ) {
        successfulStationeryPaymentsWithoutOrder.push({
          paymentId: payment.id,
          studentId: payment.studentId,
          amount: payment.amount.toFixed(2),
        });
      }
      if (linkedOrders.length > 1) {
        for (const order of linkedOrders) {
          invalidStationeryPaymentLinks.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            paymentId: payment.id,
            reason: 'A stationery payment is linked to more than one order.',
          });
        }
      }
    }

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
        orphanWalletPaymentLinks,
        invalidWalletPaymentLinks,
        invalidWalletDirections,
        invalidWalletReversals,
        successfulWalletTopUpsWithoutLedger,
        negativeWalletBalances,
        successfulStationeryPaymentsWithoutOrder,
        invalidStationeryPaymentLinks,
        unbalancedJournalTransactions,
        missingPaymentJournalEntries,
        missingRefundJournalEntries,
      },
      healthy:
        orphanAllocations.length === 0 &&
        invalidStatusAllocations.length === 0 &&
        overAllocatedPayments.length === 0 &&
        overRefundedPayments.length === 0 &&
        statusMismatches.length === 0 &&
        succeededWithoutReceipt.length === 0 &&
        orphanWalletPaymentLinks.length === 0 &&
        invalidWalletPaymentLinks.length === 0 &&
        invalidWalletDirections.length === 0 &&
        invalidWalletReversals.length === 0 &&
        successfulWalletTopUpsWithoutLedger.length === 0 &&
        negativeWalletBalances.length === 0 &&
        successfulStationeryPaymentsWithoutOrder.length === 0 &&
        invalidStationeryPaymentLinks.length === 0 &&
        unbalancedJournalTransactions.length === 0 &&
        missingPaymentJournalEntries.length === 0 &&
        missingRefundJournalEntries.length === 0,
    };
  }
}
