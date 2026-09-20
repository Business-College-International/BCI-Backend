import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InvoiceStatus, PaymentStatus, Prisma, WalletTransactionDirection, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { NormalizedPaymentWebhook } from './payment-webhook.normalization';

const TERMINAL_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED,
]);

@Injectable()
export class PaymentWebhookProcessor {
  constructor(private readonly prisma: PrismaService) {}

  async apply(normalized: NormalizedPaymentWebhook, eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.providerWebhookEvent.findUnique({
        where: { provider_eventId: { provider: normalized.provider, eventId } },
      });
      if (!event) throw new NotFoundException('Provider webhook event was not recorded.');
      if (event.processedAt) return { applied: false, reason: 'duplicate-event' as const };

      const paymentWhere = normalized.providerReference && normalized.clientReference
        ? {
            provider: normalized.provider,
            providerReference: normalized.providerReference,
            clientReference: normalized.clientReference,
          }
        : normalized.providerReference
          ? {
              provider: normalized.provider,
              providerReference: normalized.providerReference,
            }
          : {
              provider: normalized.provider,
              clientReference: normalized.clientReference!,
            };

      const paymentCandidate = await tx.payment.findFirst({
        where: paymentWhere,
        select: { id: true },
      });

      if (!paymentCandidate) {
        await tx.providerWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), processingError: 'No matching payment record was found.' },
        });
        return { applied: false, reason: 'payment-not-found' as const };
      }

      await tx.$executeRaw`SELECT id FROM "Payment" WHERE id = ${paymentCandidate.id} FOR UPDATE`;

      const payment = await tx.payment.findUnique({
        where: { id: paymentCandidate.id },
        include: {
          attempts: true,
          allocations: { select: { invoiceId: true } },
          paymentIntents: { select: { id: true, invoiceId: true, amount: true, status: true, expiresAt: true } },
        },
      });
      if (!payment) throw new NotFoundException('Payment not found after locking.');

      if (normalized.amount !== null && normalized.amount !== payment.amount.toFixed(2)) {
        await tx.providerWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), processingError: 'Provider payment amount does not match the payment record.' },
        });
        return { applied: false, reason: 'amount-mismatch' as const };
      }
      if (normalized.currency !== null && normalized.currency !== payment.currency) {
        await tx.providerWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), processingError: 'Provider payment currency does not match the payment record.' },
        });
        return { applied: false, reason: 'currency-mismatch' as const };
      }

      if (TERMINAL_STATUSES.has(payment.status) && payment.status !== normalized.paymentStatus) {
        await tx.providerWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), processingError: `Terminal payment status ${payment.status} cannot move to ${normalized.paymentStatus}.` },
        });
        return { applied: false, reason: 'terminal-status-protected' as const };
      }

      if (normalized.paymentStatus === PaymentStatus.SUCCEEDED) {
        if (payment.purpose === 'FEE') {
          const intentTotal = payment.paymentIntents.reduce((sum, intent) => sum.plus(intent.amount), new Prisma.Decimal(0));
          if (payment.paymentIntents.length === 0 || !intentTotal.eq(payment.amount)) {
            await tx.providerWebhookEvent.update({
              where: { id: event.id },
              data: { processedAt: new Date(), processingError: 'Verified fee payment does not match its payment-intent reservation total.' },
            });
            return { applied: false, reason: 'payment-intent-total-mismatch' as const };
          }
        }
        if (payment.purpose === 'WALLET_TOP_UP' && !payment.studentId) {
          await tx.providerWebhookEvent.update({
            where: { id: event.id },
            data: { processedAt: new Date(), processingError: 'A wallet top-up payment must reference a student.' },
          });
          return { applied: false, reason: 'wallet-student-missing' as const };
        }
        if (payment.purpose === 'STATIONERY') {
          await tx.$executeRaw`SELECT id FROM "StationeryOrder" WHERE "paymentId" = ${payment.id} FOR UPDATE`;
          const order = await tx.stationeryOrder.findFirst({
            where: { paymentId: payment.id },
            select: { id: true, status: true, totalAmount: true, studentId: true, guardianId: true },
          });
          if (!order) {
            await tx.providerWebhookEvent.update({
              where: { id: event.id },
              data: { processedAt: new Date(), processingError: 'A stationery payment must reference a matching stationery order.' },
            });
            return { applied: false, reason: 'stationery-order-missing' as const };
          }
          if (!order.totalAmount.eq(payment.amount) || order.studentId !== payment.studentId || order.guardianId !== payment.guardianId) {
            await tx.providerWebhookEvent.update({
              where: { id: event.id },
              data: { processedAt: new Date(), processingError: 'Stationery order does not match the verified payment.' },
            });
            return { applied: false, reason: 'stationery-order-mismatch' as const };
          }
        }
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

      const intentStatus =
        normalized.paymentStatus === PaymentStatus.SUCCEEDED
          ? 'SUCCEEDED'
          : normalized.paymentStatus === PaymentStatus.FAILED
            ? 'FAILED'
            : normalized.paymentStatus === PaymentStatus.CANCELLED
              ? 'CANCELLED'
              : 'PROCESSING';
      await tx.paymentIntent.updateMany({
        where: { paymentId: payment.id, status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] } },
        data: {
          status: intentStatus,
          providerReference: normalized.providerReference,
          completedAt: normalized.paymentStatus === PaymentStatus.SUCCEEDED || normalized.paymentStatus === PaymentStatus.FAILED || normalized.paymentStatus === PaymentStatus.CANCELLED ? normalized.completedAt : null,
          failureCode: normalized.failureCode,
          failureMessage: normalized.failureMessage,
        },
      });

      const attempt = payment.attempts.find(
        (candidate) => candidate.provider === normalized.provider && candidate.providerReference === normalized.providerReference,
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
        const receipt = await tx.receipt.upsert({
          where: { paymentId: payment.id },
          update: {},
          create: {
            paymentId: payment.id,
            receiptNumber: nextReceiptNumber(),
          },
          select: { id: true, receiptNumber: true },
        });

        await tx.auditLog.create({
          data: {
            action: 'CREATE',
            entityType: 'Receipt',
            entityId: receipt.id,
            afterJson: {
              paymentId: payment.id,
              receiptNumber: receipt.receiptNumber,
              amount: payment.amount.toFixed(2),
              currency: payment.currency,
            },
          },
        });
        if (payment.purpose === 'WALLET_TOP_UP') {
          if (!payment.studentId) {
            await tx.providerWebhookEvent.update({
              where: { id: event.id },
              data: { processedAt: new Date(), processingError: 'A wallet top-up payment must reference a student.' },
            });
            return { applied: false, reason: 'wallet-student-missing' as const };
          }

          const wallet = await tx.wallet.upsert({
            where: { studentId: payment.studentId },
            update: {},
            create: { studentId: payment.studentId, currency: payment.currency },
            select: { studentId: true, currency: true },
          });

          const existingWalletTransaction = await tx.walletTransaction.findUnique({
            where: { paymentId: payment.id },
            select: {
              id: true,
              walletId: true,
              type: true,
              direction: true,
              amount: true,
              providerReference: true,
            },
          });

          let walletTransactionId = existingWalletTransaction?.id ?? null;
          if (existingWalletTransaction) {
            if (
              existingWalletTransaction.walletId !== wallet.studentId ||
              existingWalletTransaction.type !== WalletTransactionType.TOP_UP ||
              existingWalletTransaction.direction !== WalletTransactionDirection.CREDIT ||
              !existingWalletTransaction.amount.eq(payment.amount)
            ) {
              throw new Error('Existing wallet ledger entry does not match the verified top-up payment.');
            }
          } else {
            const walletTransaction = await tx.walletTransaction.create({
              data: {
                walletId: wallet.studentId,
                type: WalletTransactionType.TOP_UP,
                direction: WalletTransactionDirection.CREDIT,
                amount: payment.amount,
                paymentId: payment.id,
                providerReference: normalized.providerReference,
                note: 'Verified provider wallet top-up',
              },
            });
            walletTransactionId = walletTransaction.id;
          }

          await tx.auditLog.create({
            data: {
              action: 'RECONCILE',
              entityType: 'WalletTransaction',
              entityId: walletTransactionId!,
              afterJson: {
                paymentId: payment.id,
                studentId: payment.studentId,
                amount: payment.amount.toFixed(2),
                currency: payment.currency,
                providerReference: normalized.providerReference,
                direction: WalletTransactionDirection.CREDIT,
                type: WalletTransactionType.TOP_UP,
                idempotent: Boolean(existingWalletTransaction),
              },
            },
          });
        }

        if (payment.purpose === 'STATIONERY') {
          await tx.$executeRaw`SELECT id FROM "StationeryOrder" WHERE "paymentId" = ${payment.id} FOR UPDATE`;
          const order = await tx.stationeryOrder.findFirst({
            where: { paymentId: payment.id },
            select: { id: true, status: true, totalAmount: true, studentId: true, guardianId: true },
          });
          if (order) {
            if (!order.totalAmount.eq(payment.amount) || order.studentId !== payment.studentId || order.guardianId !== payment.guardianId) {
              throw new Error('Stationery order does not match the settled payment.');
            }
            if (order.status === 'DRAFT') {
              await tx.stationeryOrder.update({ where: { id: order.id }, data: { status: 'PAID' } });
              await tx.auditLog.create({
                data: {
                  action: 'RECONCILE',
                  entityType: 'StationeryOrder',
                  entityId: order.id,
                  afterJson: { paymentId: payment.id, status: 'PAID' },
                },
              });
            } else if (!['PAID', 'READY_FOR_COLLECTION', 'COLLECTED'].includes(order.status)) {
              throw new Error('Stationery order ' + order.id + ' is in unexpected status ' + order.status + ' after payment settlement.');
            }
          }
        }
        if (payment.purpose === 'FEE') {
          const intentTotal = payment.paymentIntents.reduce((sum, intent) => sum.plus(intent.amount), new Prisma.Decimal(0));
          if (payment.paymentIntents.length === 0 || !intentTotal.eq(payment.amount)) {
            await tx.providerWebhookEvent.update({
              where: { id: event.id },
              data: { processedAt: new Date(), processingError: 'Verified fee payment does not match its payment-intent reservation total.' },
            });
            return { applied: false, reason: 'payment-intent-total-mismatch' as const };
          }
          for (const intent of payment.paymentIntents) {
            await tx.paymentAllocation.upsert({
              where: { paymentId_invoiceId: { paymentId: payment.id, invoiceId: intent.invoiceId } },
              update: { amount: intent.amount },
              create: { paymentId: payment.id, invoiceId: intent.invoiceId, amount: intent.amount },
            });
          }
        }
        const invoiceIds = [...new Set(payment.paymentIntents.map((intent) => intent.invoiceId))];
        for (const invoiceId of invoiceIds) {
          await tx.$executeRaw`SELECT id FROM "StudentInvoice" WHERE id = ${invoiceId} FOR UPDATE`;
          const invoice = await tx.studentInvoice.findUnique({
            where: { id: invoiceId },
            include: {
              lines: { select: { amountDue: true } },
              allocations: { select: { amount: true, payment: { select: { status: true } } } },
            },
          });
          if (!invoice) continue;

          const due = invoice.lines.reduce(
            (sum, line) => sum.plus(line.amountDue),
            new Prisma.Decimal(0),
          );
          const settled = invoice.allocations
            .filter((allocation) => allocation.payment.status === PaymentStatus.SUCCEEDED)
            .reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));

          const nextStatus = settled.gte(due) ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
          if (invoice.status !== InvoiceStatus.VOID && invoice.status !== nextStatus) {
            await tx.studentInvoice.update({ where: { id: invoice.id }, data: { status: nextStatus } });
          }
        }
      }

      await tx.providerWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), processingError: null },
      });

      return { applied: true, paymentId: payment.id, status: normalized.paymentStatus };
    });
  }
}

function nextReceiptNumber() {
  const year = new Date().getUTCFullYear();
  return `BCI-RCPT-${year}-${randomBytes(6).toString('hex').toUpperCase()}`;
}