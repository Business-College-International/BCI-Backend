import { NotImplementedException } from '@nestjs/common';
import { MoolreAdapter } from './moolre.adapter';

describe('MoolreAdapter', () => {
  it('keeps provider verification disabled until the production contract is verified', async () => {
    const adapter = new MoolreAdapter();
    await expect(adapter.verifyWebhook({
      provider: 'MOOLRE',
      eventId: 'event-1',
      eventType: 'payment.succeeded',
      signature: 'signature',
      rawPayload: {},
    })).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('keeps payment initiation disabled until reservation/provider gates are complete', async () => {
    const adapter = new MoolreAdapter();
    await expect(adapter.initiatePayment({
      clientReference: 'client-1',
      amount: '100.00',
      currency: 'GHS',
      purpose: 'FEE',
      callbackUrl: 'https://example.invalid/payment/callback',
      customer: { name: 'Test Guardian', phone: '+233000000000' },
    })).rejects.toBeInstanceOf(NotImplementedException);
  });
});
