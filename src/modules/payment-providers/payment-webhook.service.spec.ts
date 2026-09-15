import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { PaymentWebhookService, rejectUnverifiedWebhook } from './payment-webhook.service';

describe('PaymentWebhookService', () => {
  it('records a verified webhook once and treats repeats as duplicates', async () => {
    const event = { id: 'event-1', provider: 'MOOLRE', eventId: 'evt-1', eventType: 'payment.succeeded', signatureVerified: true, payload: { reference: 'pay-1' } };
    let existing: any = null;
    const tx = {
      providerWebhookEvent: {
        findUnique: jest.fn().mockImplementation(async () => existing),
        create: jest.fn().mockImplementation(async ({ data }) => { existing = { ...data, id: event.id }; return { ...event, ...data }; }),
      },
    };
    const prisma = { $transaction: jest.fn(async (callback: (arg: any) => unknown) => callback(tx)) };
    const provider = { provider: 'MOOLRE', verifyWebhook: jest.fn().mockResolvedValue({ provider: 'MOOLRE', eventId: 'evt-1', eventType: 'payment.succeeded', signature: 'verified', rawPayload: { reference: 'pay-1' } }) };
    const service = new PaymentWebhookService(prisma as never);

    await expect(service.acceptVerifiedEvent(provider as never, { provider: 'MOOLRE', eventId: 'evt-1', eventType: 'payment.succeeded', signature: 'input', rawPayload: {} })).resolves.toMatchObject({ duplicate: false });
    await expect(service.acceptVerifiedEvent(provider as never, { provider: 'MOOLRE', eventId: 'evt-1', eventType: 'payment.succeeded', signature: 'input', rawPayload: {} })).resolves.toMatchObject({ duplicate: true });
    expect(tx.providerWebhookEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects provider mismatch before persistence', async () => {
    const prisma = { $transaction: jest.fn() };
    const provider = { provider: 'MOOLRE', verifyWebhook: jest.fn() };
    const service = new PaymentWebhookService(prisma as never);
    await expect(service.acceptVerifiedEvent(provider as never, { provider: 'OTHER', eventId: 'evt-1', eventType: 'payment.succeeded', signature: 'x', rawPayload: {} })).rejects.toBeInstanceOf(ConflictException);
    expect(provider.verifyWebhook).not.toHaveBeenCalled();
  });

  it('rejects any processing path that is not signature-verified', () => {
    expect(() => rejectUnverifiedWebhook()).toThrow(UnauthorizedException);
  });
});
