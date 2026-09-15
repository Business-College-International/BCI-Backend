import { Injectable, NotImplementedException } from '@nestjs/common';
import { PaymentProviderPort, ProviderWebhook, VerifiedProviderWebhook } from './payment-provider.port';

/**
 * Moolre-specific transport is intentionally disabled until the production
 * provider contract, callback signature scheme, and environment credentials
 * are independently verified. This prevents guessed API behavior from moving money.
 */
@Injectable()
export class MoolreAdapter implements PaymentProviderPort {
  readonly provider = 'MOOLRE';

  async verifyWebhook(_input: ProviderWebhook): Promise<VerifiedProviderWebhook> {
    throw new NotImplementedException('Moolre webhook verification is not enabled until the verified provider contract is configured.');
  }

  async initiatePayment(_input: {
    clientReference: string;
    amount: string;
    currency: string;
    purpose: string;
    callbackUrl: string;
    customer: { name: string; phone: string };
  }): Promise<never> {
    throw new NotImplementedException('Moolre payment initiation is blocked until invoice reservation and provider verification are complete.');
  }
}
