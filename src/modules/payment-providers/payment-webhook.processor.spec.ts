import { PaymentStatus } from '@prisma/client';
import { PaymentWebhookProcessor } from './payment-webhook.processor';

function mockPrisma() {
  return {
    $transaction: jest.fn(),
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
  it('updates a matching payment, provider attempt, and settled invoice', async () => {
    const prisma = mockPrisma();
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      payment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1', amount: { toFixed: () => '100.00' }, currency: 'GHS', status: PaymentStatus.PROCESSING,
          attempts: [{ id: 'attempt-1', provider: 'TEST', providerReference: 'provider-ref-1' }],
          allocations: [{ invoiceId: 'invoice-1', amount: { plus: jest.fn() } }],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      paymentProviderAttempt: { update: jest.fn().mockResolvedValue({}) },
      providerWebhookEvent: { findUnique: jest.fn().mockResolvedValue({ id: 'event-1' }), update: jest.fn().mockResolvedValue({}) },
      studentInvoice: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invoice-1', status: 'OPEN', lines: [{ amountDue: { plus: (v: unknown) => v, }, }],
          allocations: [{ amount: { toString: () => '100.00' }, payment: { status: PaymentStatus.SUCCEEDED } }],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      paymentAllocation: { deleteMany: jest.fn() },
    }));

    const tx = undefined;
    const processor = new PaymentWebhookProcessor(prisma);
    await expect(processor.apply(normalized, 'event-1')).resolves.toMatchObject({ applied: true, paymentId: 'payment-1', status: PaymentStatus.SUCCEEDED });
  });

  it('persists an amount mismatch instead of rolling it back', async () => {
    const prisma = mockPrisma();
    let recordedError: string | null = null;
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'payment-1', amount: { toFixed: () => '90.00' }, currency: 'GHS', status: PaymentStatus.PROCESSING, attempts: [], allocations: [] }) },
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

  it('releases reserved allocations when the provider fails', async () => {
    const prisma = mockPrisma();
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'payment-1', amount: { toFixed: () => '100.00' }, currency: 'GHS', status: PaymentStatus.PROCESSING, attempts: [], allocations: [{ invoiceId: 'invoice-1', amount: '100.00' }] }), update: jest.fn() },
      paymentProviderAttempt: { update: jest.fn() },
      providerWebhookEvent: { findUnique: jest.fn().mockResolvedValue({ id: 'event-1' }), update: jest.fn() },
      paymentAllocation: { deleteMany },
      studentInvoice: { findUnique: jest.fn().mockResolvedValue({ id: 'invoice-1', status: 'PARTIALLY_PAID', lines: [{ amountDue: { toString: () => '100.00', plus: () => ({}) } }], allocations: [] }), update: jest.fn() },
    }));

    const processor = new PaymentWebhookProcessor(prisma);
    await expect(processor.apply({ ...normalized, paymentStatus: PaymentStatus.FAILED, failureCode: 'P02' }, 'event-1'))
      .resolves.toMatchObject({ applied: true, status: PaymentStatus.FAILED });
    expect(deleteMany).toHaveBeenCalledWith({ where: { paymentId: 'payment-1' } });
  });

  it('does not regress a terminal successful payment to processing', async () => {
    const prisma = mockPrisma();
    let errorMessage: string | null = null;
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback({
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'payment-1', amount: { toFixed: () => '100.00' }, currency: 'GHS', status: PaymentStatus.SUCCEEDED, attempts: [], allocations: [] }), update: jest.fn() },
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
