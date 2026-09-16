import { PaymentStatus } from '@prisma/client';
import { PaymentWebhookProcessor } from './payment-webhook.processor';

function mockPrisma() {
  return {
    $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
      payment: { findFirst: jest.fn(), update: jest.fn() },
      paymentProviderAttempt: { update: jest.fn() },
      providerWebhookEvent: { findUnique: jest.fn(), update: jest.fn() },
    })),
  } as any;
}

const normalized = {
  provider: 'TEST',
  providerReference: 'provider-ref-1',
  clientReference: 'client-ref-1',
  paymentStatus: PaymentStatus.SUCCEEDED,
  amount: '100.00',
  currency: 'GHS',
  completedAt: new Date('2026-09-16T08:00:00.000Z'),
  failureCode: null,
  failureMessage: null,
};

describe('PaymentWebhookProcessor', () => {
  it('updates a matching payment and provider attempt', async () => {
    const prisma = mockPrisma();
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => {
      const tx = {
        payment: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'payment-1',
            amount: { toFixed: () => '100.00' },
            currency: 'GHS',
            status: PaymentStatus.PROCESSING,
            attempts: [{ id: 'attempt-1', provider: 'TEST', providerReference: 'provider-ref-1' }],
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        paymentProviderAttempt: { update: jest.fn().mockResolvedValue({}) },
        providerWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'event-1' }),
          update: jest.fn().mockResolvedValue({}),
        },
      };
      return callback(tx);
    });

    const processor = new PaymentWebhookProcessor(prisma);
    await expect(processor.apply(normalized, 'event-1')).resolves.toMatchObject({ applied: true, paymentId: 'payment-1', status: PaymentStatus.SUCCEEDED });
  });

  it('persists an amount mismatch instead of rolling it back', async () => {
    const prisma = mockPrisma();
    let recordedError: string | null = null;
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'payment-1', amount: { toFixed: () => '90.00' }, currency: 'GHS', status: PaymentStatus.PROCESSING, attempts: [] }) },
      paymentProviderAttempt: { update: jest.fn() },
      providerWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1' }),
        update: jest.fn().mockImplementation(async ({ data }) => { recordedError = data.processingError; return {}; }),
      },
    }));

    const processor = new PaymentWebhookProcessor(prisma);
    await expect(processor.apply(normalized, 'event-1')).resolves.toMatchObject({ applied: false, reason: 'amount-mismatch' });
    expect(recordedError).toContain('amount');
  });

  it('does not regress a terminal successful payment to processing', async () => {
    const prisma = mockPrisma();
    let errorMessage: string | null = null;
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'payment-1', amount: { toFixed: () => '100.00' }, currency: 'GHS', status: PaymentStatus.SUCCEEDED, attempts: [] }), update: jest.fn() },
      paymentProviderAttempt: { update: jest.fn() },
      providerWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'event-1' }),
        update: jest.fn().mockImplementation(async ({ data }) => { errorMessage = data.processingError; return {}; }),
      },
    }));

    const processor = new PaymentWebhookProcessor(prisma);
    await expect(processor.apply({ ...normalized, paymentStatus: PaymentStatus.PROCESSING }, 'event-1'))
      .resolves.toMatchObject({ applied: false, reason: 'terminal-status-protected' });
    expect(errorMessage).toContain('Terminal payment status');
  });
});
