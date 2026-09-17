import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PaymentWebhookProcessor } from './payment-webhook.processor';

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
  it('updates a matching payment, provider attempt and invoice settlement state', async () => {
    const invoiceUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        payment: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'payment-1',
            amount: new Prisma.Decimal('100.00'),
            currency: 'GHS',
            status: PaymentStatus.PROCESSING,
            attempts: [{ id: 'attempt-1', provider: 'TEST', providerReference: 'provider-ref-1' }],
            allocations: [{ invoiceId: 'invoice-1' }],
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        paymentProviderAttempt: { update: jest.fn().mockResolvedValue({}) },
        studentInvoice: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'invoice-1',
            status: InvoiceStatus.PARTIALLY_PAID,
            lines: [{ amountDue: new Prisma.Decimal('100.00') }],
            allocations: [
              { amount: new Prisma.Decimal('100.00'), payment: { status: PaymentStatus.SUCCEEDED } },
            ],
          }),
          update: invoiceUpdate,
        },
        providerWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'event-1', processedAt: null }),
          update: jest.fn().mockResolvedValue({}),
        },
      })),
    };

    const processor = new PaymentWebhookProcessor(prisma as any);
    await expect(processor.apply(normalized, 'event-1')).resolves.toMatchObject({ applied: true, paymentId: 'payment-1', status: PaymentStatus.SUCCEEDED });
    expect(invoiceUpdate).toHaveBeenCalledWith({ where: { id: 'invoice-1' }, data: { status: InvoiceStatus.PAID } });
  });

  it('ignores an event that was already processed', async () => {
    const event = { id: 'event-1', processedAt: new Date() };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        providerWebhookEvent: { findUnique: jest.fn().mockResolvedValue(event) },
      })),
    };

    const processor = new PaymentWebhookProcessor(prisma as any);
    await expect(processor.apply(normalized, 'event-1')).resolves.toEqual({ applied: false, reason: 'duplicate-event' });
  });

  it('persists an amount mismatch instead of rolling it back', async () => {
    let recordedError: string | null = null;
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        payment: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'payment-1',
            amount: new Prisma.Decimal('90.00'),
            currency: 'GHS',
            status: PaymentStatus.PROCESSING,
            attempts: [],
            allocations: [],
          }),
        },
        providerWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'event-1', processedAt: null }),
          update: jest.fn().mockImplementation(async ({ data }) => { recordedError = data.processingError; return {}; }),
        },
      })),
    };

    const processor = new PaymentWebhookProcessor(prisma as any);
    await expect(processor.apply(normalized, 'event-1')).resolves.toMatchObject({ applied: false, reason: 'amount-mismatch' });
    expect(recordedError).toContain('amount');
  });

  it('does not regress a terminal successful payment to processing', async () => {
    let errorMessage: string | null = null;
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        payment: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'payment-1',
            amount: new Prisma.Decimal('100.00'),
            currency: 'GHS',
            status: PaymentStatus.SUCCEEDED,
            attempts: [],
            allocations: [],
          }),
        },
        providerWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'event-1', processedAt: null }),
          update: jest.fn().mockImplementation(async ({ data }) => { errorMessage = data.processingError; return {}; }),
        },
      })),
    };

    const processor = new PaymentWebhookProcessor(prisma as any);
    await expect(processor.apply({ ...normalized, paymentStatus: PaymentStatus.PROCESSING }, 'event-1'))
      .resolves.toMatchObject({ applied: false, reason: 'terminal-status-protected' });
    expect(errorMessage).toContain('Terminal payment status');
  });
});
