import { Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { NormalizedPaymentWebhook } from './payment-webhook.normalization';

const TERMINAL_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
]);
const ACTIVE_ALLOCATION_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.PENDING,
  PaymentStatus.PROCESSING,
  PaymentStatus.SUCCEEDED,
]);

@Injectable()
export class PaymentWebhookProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async apply(normalized: NormalizedPaymentWebhook, eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          provider: normalized.provider,
          OR: [
            { providerReference: normalized.providerReference },
            ...(normalized.clientReference ? [{ clientReference: normalized.clientReference }] : []),
          ],
        },
        include: { attempts: true, allocations: { select: { id: true, invoiceId: true, amount: true } } },
      });

      const event = await tx.providerWebhookEvent.findUnique({
        where: { provider_eventId: { provider: normalized.provider, eventId } },
      });
      if (!event) throw new NotFoundException('Provider webhook event was not recorded.');

      if (event.processedAt) return { applied: false, reason: 'duplicate-processed-event' as const, paymentId: payment?.id ?? null };

      if (!payment) {
        await tx.providerWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), processingError: 'No matching payment record was found.' },
        });
        return { applied: false, reason: 'payment-not-found' as const };
      }

      if (normalized.amount !== null && normalized.amount !== payment.amount.toFixed(2)) {
        await this.markEventError(tx, event.id, 'Provider payment amount does not match the payment record.');
        return { applied: false, reason: 'amount-mismatch' as const };
      }
      if (normalized.currency !== null && normalized.currency !== payment.currency) {
        await this.markEventError(tx, event.id, 'Provider payment currency does not match the payment record.');
        return { applied: false, reason: 'currency-mismatch' as const };
      }

      if (TERMINAL_STATUSES.has(payment.status) && payment.status !== normalized.paymentStatus) {
        await this.markEventError(tx, event.id, `Terminal payment status ${payment.status} cannot move to ${normalized.paymentStatus}.`);
        return { applied: false, reason: 'terminal-status-protected' as const };
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: normalized.paymentStatus,
          providerReference: normalized.providerReference,
          completedAt: normalized.completedAt,
          failureCode: normalized.failureCode,
          failureMessage: normalized.failureMessage,
        },
      });

      const attempt = payment.attempts.find(
        (candidate) =>
          candidate.provider === normalized.provider &&
          (candidate.providerReference === normalized.providerReference || candidate.providerReference == null),
      );
      if (attempt) {
        await tx.paymentProviderAttempt.update({
          where: { id: attempt.id },
          data: {
            status: normalized.paymentStatus,
            providerReference: normalized.providerReference,
            resolvedAt: normalized.completedAt,
            failureCode: normalized.failureCode,
            failureMessage: normalized.failureMessage,
          },
        });
      }

      if (normalized.paymentStatus === PaymentStatus.SUCCEEDED) {
        await this.refreshInvoiceStatuses(tx, payment.allocations.map((allocation) => allocation.invoiceId));
      } else if ([PaymentStatus.FAILED, PaymentStatus.CANCELLED].includes(normalized.paymentStatus)) {
        await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });
        await this.refreshInvoiceStatuses(tx, payment.allocations.map((allocation) => allocation.invoiceId));
      } else if (ACTIVE_ALLOCATION_STATUSES.has(normalized.paymentStatus)) {
        // PENDING/PROCESSING retains the reservation so another payment cannot claim the same balance.
      }

      await tx.providerWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), processingError: null } });
      return { applied: true, paymentId: payment.id, status: normalized.paymentStatus };
    });
  }

  private async refreshInvoiceStatuses(tx: Prisma.TransactionClient, invoiceIds: string[]) {
    const ids = [...new Set(invoiceIds)];
    for (const invoiceId of ids) {
      const invoice = await tx.studentInvoice.findUnique({
        where: { id: invoiceId },
        include: {
          lines: true,
          allocations: { include: { payment: { select: { status: true } } } },
        },
      });
      if (!invoice || invoice.status === InvoiceStatus.VOID) continue;

      const due = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
      const allocated = invoice.allocations
        .filter((allocation) => allocation.payment.status === PaymentStatus.SUCCEEDED)
        .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
      const nextStatus = allocated.gte(due)
        ? InvoiceStatus.PAID
        : allocated.gt(0)
          ? InvoiceStatus.PARTIALLY_PAID
          : InvoiceStatus.OPEN;

      if (invoice.status !== nextStatus) {
        await tx.studentInvoice.update({ where: { id: invoice.id }, data: { status: nextStatus } });
      }
    }
  }

  private async markEventError(tx: Prisma.TransactionClient, eventId: string, processingError: string) {
    await tx.providerWebhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), processingError } });
  }
}
