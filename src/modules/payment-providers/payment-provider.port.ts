import { NormalizedPaymentWebhook } from './payment-webhook.normalization';

export type ProviderWebhook = {
  provider: string;
  eventId: string;
  eventType: string;
  signature: string;
  rawPayload: unknown;
  rawBody?: string;
};

export type VerifiedProviderWebhook = ProviderWebhook & {
  signatureVerified: true;
};

export type InitiatePaymentInput = {
  clientReference: string;
  amount: string;
  currency: string;
  purpose: string;
  callbackUrl: string;
  customer: { name: string; phone: string; network?: string };
};

export type InitiatePaymentResult = {
  providerReference: string | null;
  requiresOtp: boolean;
  mock: boolean;
};

export interface PaymentProviderPort {
  readonly provider: string;

  verifyWebhook(input: ProviderWebhook): Promise<VerifiedProviderWebhook>;

  normalizeWebhook(input: VerifiedProviderWebhook): NormalizedPaymentWebhook;

  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
}
