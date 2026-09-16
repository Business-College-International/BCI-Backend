import { NormalizedPaymentWebhook } from './payment-webhook.normalization';

export type ProviderWebhook = {
  provider: string;
  eventId: string;
  eventType: string;
  signature: string;
  rawPayload: unknown;
};

export type VerifiedProviderWebhook = ProviderWebhook & {
  signatureVerified: true;
};

export interface PaymentProviderPort {
  readonly provider: string;

  verifyWebhook(input: ProviderWebhook): Promise<VerifiedProviderWebhook>;

  normalizeWebhook(input: VerifiedProviderWebhook): NormalizedPaymentWebhook;

  initiatePayment(input: {
    clientReference: string;
    amount: string;
    currency: string;
    purpose: string;
    callbackUrl: string;
    customer: { name: string; phone: string };
  }): Promise<never>;
}
