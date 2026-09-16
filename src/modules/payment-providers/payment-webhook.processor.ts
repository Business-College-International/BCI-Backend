import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
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
      const payment = await tx.payment.findFirst({
        where: {
          provider: normalized.provider,
          OR: [
            { providerReference: normalized.providerReference },
            ...(normalized.clientReference ? [{ clientReference: normalized.clientReference }] : []),
          ],
        },
        include: { attempts: true },
      });

      const event = await tx.providerWebhookEvent.findUnique({
        where: { provider_eventId: { provider: normalized.provider, eventId } },
      });
      if (!event) throw new NotFoundException('Provider webhook event was not recorded.');

      if (!payment) {
        await tx.providerWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), processingError: 'No matching payment record was found.' },
        });
        return { applied: false, reason: 'payment-not-found' as const };
      }

      if (normalized.amount !== null && normalized.amount !== payment.amount.toFixed(2)) {
        await tx.providerWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), processingError: 'Provider amount does not match the payment record.' },
        });
        throw new BadRequestException('Provider payment amount does not match the payment record.');
      }
      if (normalized.currency !== null && normalized.currency !== payment.currency) {
        await tx.providerWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), processingError: 'Provider currency does not match the payment record.' },
        });
        throw new BadRequestException('Provider payment currency does not match the payment record.');
      }

      if (TERMINAL_STATUSES.has(payment.status) && payment.status !== normalized.paymentStatus) {
        await tx.providerWebhookEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), processingError: `Terminal payment status ${payment.status} cannot move to ${normalized.paymentStatus}.` },
        });
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

      await tx.providerWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), processingError: null },
      });

      return { applied: true, paymentId: payment.id, status: normalized.paymentStatus };
    });
  }
}
