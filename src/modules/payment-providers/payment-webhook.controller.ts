import { Controller, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { MoolreAdapter } from './moolre.adapter';
import { PaymentWebhookProcessor } from './payment-webhook.processor';
import { PaymentWebhookService } from './payment-webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('payment-providers/webhooks')
export class PaymentWebhookController {
  constructor(
    private readonly moolre: MoolreAdapter,
    private readonly webhookService: PaymentWebhookService,
    private readonly processor: PaymentWebhookProcessor,
  ) {}

  @Post('moolre')
  @HttpCode(200)
  async receive(@Req() request: RawBodyRequest, @Headers() headers: Record<string, string | string[] | undefined>) {
    const rawBody = request.rawBody?.toString('utf8') ?? JSON.stringify(request.body ?? {});
    const payload = (request.body ?? {}) as Record<string, unknown>;
    const signatureHeader = firstHeader(headers, 'x-moolre-signature')
      ?? firstHeader(headers, 'x-signature')
      ?? firstHeader(headers, 'signature');
    if (!signatureHeader) throw new UnauthorizedException('Missing webhook signature.');

    const eventId = firstHeader(headers, 'x-moolre-event-id')
      ?? (typeof payload.eventId === 'string' ? payload.eventId : undefined)
      ?? (typeof payload.id === 'string' ? payload.id : undefined)
      ?? (typeof (payload.data as Record<string, unknown> | undefined)?.id === 'string'
        ? (payload.data as Record<string, unknown>).id as string
        : undefined)
      ?? createHash('sha256').update(rawBody).digest('hex');
    const eventType = typeof payload.eventType === 'string' ? payload.eventType : 'payment.webhook';

    const input = {
      provider: this.moolre.provider,
      eventId,
      eventType,
      signature: signatureHeader,
      rawPayload: payload,
      rawBody,
    };

    const recorded = await this.webhookService.acceptVerifiedEvent(this.moolre, input);
    if (recorded.duplicate) return { accepted: true, duplicate: true };

    const normalized = this.moolre.normalizeWebhook({ ...input, signatureVerified: true });
    const applied = await this.processor.apply(normalized, eventId);
    return { accepted: true, duplicate: false, applied };
  }
}

function firstHeader(headers: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = headers[key] ?? headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
