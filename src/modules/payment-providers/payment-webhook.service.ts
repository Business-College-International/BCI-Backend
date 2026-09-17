import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PaymentProviderPort, ProviderWebhook } from './payment-provider.port';

@Injectable()
export class PaymentWebhookService {
  constructor(private readonly prisma: PrismaService) {}

  async acceptVerifiedEvent(provider: PaymentProviderPort, input: ProviderWebhook) {
    if (input.provider !== provider.provider) throw new ConflictException('Webhook provider mismatch.');
    const verified = await provider.verifyWebhook(input);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.providerWebhookEvent.findUnique({
        where: { provider_eventId: { provider: verified.provider, eventId: verified.eventId } },
      });
      if (existing) {
        return {
          duplicate: Boolean(existing.processedAt),
          retry: !existing.processedAt,
          event: existing,
        };
      }

      const event = await tx.providerWebhookEvent.create({
        data: {
          provider: verified.provider,
          eventId: verified.eventId,
          eventType: verified.eventType,
          signatureVerified: true,
          payload: verified.rawPayload as object,
        },
      });

      return { duplicate: false, retry: false, event };
    });
  }
}

export function rejectUnverifiedWebhook(): never {
  throw new UnauthorizedException('Webhook signature verification is required before processing.');
}
