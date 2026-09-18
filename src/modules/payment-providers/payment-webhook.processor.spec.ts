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
        $executeRaw: jest.fn().mockResolvedValue([]),
        payment: {
          findFirst: jest.fn().mockResolvedValue({ id: 'payment-1' }),
          findUnique: jest.fn().mockResolvedValue({
            id: 'payment-1',
            amount: new Prisma.Decimal('100.00'),
            currency: 'GHS',
            purpose: 'FEE',
            studentId: 'student-1',
            status: PaymentStatus.PROCESSING,
            attempts: [{ id: 'attempt-1', provider: 'TEST', providerReference: 'provider-ref-1' }],
            allocations: [{ invoiceId: 'invoice-1' }],
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        paymentProviderAttempt: { update: jest.fn().mockResolvedValue({}) },
        receipt: { upsert: jest.fn().mockResolvedValue({ id: 'receipt-1', receiptNumber: 'BCI-RCPT-2026-TEST' }) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
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
    expect(prisma.receipt.upsert).toHaveBeenCalledWith({
      where: { paymentId: 'payment-1' },
      update: {},
      create: expect.objectContaining({ paymentId: 'payment-1', receiptNumber: expect.stringMatching(/^BCI-RCPT-2026-/) }),
      select: { id: true, receiptNumber: true },
    });
  });

  it('requires both webhook references to identify the same payment when both are supplied', async () => {
    let lookup: unknown;
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        $executeRaw: jest.fn().mockResolvedValue([]),
        payment: {
          findFirst: jest.fn().mockImplementation(async ({ where }) => {
            lookup = where;
            return null;
          }),
        },
        providerWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'event-1', processedAt: null }),
          update: jest.fn().mockResolvedValue({}),
        },
      })),
    };

    const processor = new PaymentWebhookProcessor(prisma as any);
    await expect(processor.apply(normalized, 'event-1')).resolves.toMatchObject({ applied: false, reason: 'payment-not-found' });
    expect(lookup).toEqual({
      provider: 'TEST',
      providerReference: 'provider-ref-1',
      clientReference: 'client-ref-1',
    });
  });

  it('ignores an event that was already processed', async () => {
    const event = { id: 'event-1', processedAt: new Date() };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        $executeRaw: jest.fn().mockResolvedValue([]),
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
        $executeRaw: jest.fn().mockResolvedValue([]),
        payment: {
          findFirst: jest.fn().mockResolvedValue({ id: 'payment-1' }),
          findUnique: jest.fn().mockResolvedValue({
            id: 'payment-1',
            amount: new Prisma.Decimal('90.00'),
            currency: 'GHS',
            purpose: 'FEE',
            studentId: 'student-1',
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
        $executeRaw: jest.fn().mockResolvedValue([]),
        payment: {
          findFirst: jest.fn().mockResolvedValue({ id: 'payment-1' }),
          findUnique: jest.fn().mockResolvedValue({
            id: 'payment-1',
            amount: new Prisma.Decimal('100.00'),
            currency: 'GHS',
            purpose: 'FEE',
            studentId: 'student-1',
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
  it('settles a successful wallet top-up exactly once from the verified payment fact', async () => {
    const walletUpsert = jest.fn().mockResolvedValue({ studentId: 'student-1', currency: 'GHS' });
    const walletTransactionCreate = jest.fn().mockResolvedValue({ id: 'wallet-tx-1' });
    const auditLogCreate = jest.fn().mockResolvedValue({});
    const paymentFind = jest.fn().mockResolvedValue({
      id: 'payment-1',
      amount: new Prisma.Decimal('75.00'),
      currency: 'GHS',
      purpose: 'WALLET_TOP_UP',
      studentId: 'student-1',
      status: PaymentStatus.PROCESSING,
      attempts: [{ id: 'attempt-1', provider: 'TEST', providerReference: 'provider-ref-1' }],
      allocations: [],
    });

    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        providerWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'event-1', processedAt: null }),
          update: jest.fn().mockResolvedValue({}),
        },
        payment: {
          findFirst: jest.fn().mockResolvedValue({ id: 'payment-1' }),
          findUnique: paymentFind,
          update: jest.fn().mockResolvedValue({}),
        },
        paymentProviderAttempt: { update: jest.fn().mockResolvedValue({}) },
        wallet: { upsert: walletUpsert },
        walletTransaction: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: walletTransactionCreate,
        },
        auditLog: { create: auditLogCreate },
        $executeRaw: jest.fn().mockResolvedValue([]),
      })),
    };

    const processor = new PaymentWebhookProcessor(prisma as any);
    await expect(processor.apply({ ...normalized, amount: '75.00' }, 'event-1'))
      .resolves.toMatchObject({ applied: true, paymentId: 'payment-1', status: PaymentStatus.SUCCEEDED });

    expect(walletUpsert).toHaveBeenCalledWith({
      where: { studentId: 'student-1' },
      update: {},
      create: { studentId: 'student-1', currency: 'GHS' },
      select: { studentId: true, currency: true },
    });
    expect(walletTransactionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: 'student-1',
        type: 'TOP_UP',
        direction: 'CREDIT',
        amount: new Prisma.Decimal('75.00'),
        paymentId: 'payment-1',
        providerReference: 'provider-ref-1',
      }),
    });
    expect(auditLogCreate).toHaveBeenCalled();
  });

  it('does not create a second wallet ledger entry for a different successful webhook event', async () => {
    const walletTransactionFind = jest.fn().mockResolvedValue({
      id: 'wallet-tx-1',
      walletId: 'student-1',
      type: 'TOP_UP',
      direction: 'CREDIT',
      amount: new Prisma.Decimal('75.00'),
      providerReference: 'provider-ref-1',
    });

    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        providerWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'event-2', processedAt: null }),
          update: jest.fn().mockResolvedValue({}),
        },
        payment: {
          findFirst: jest.fn().mockResolvedValue({ id: 'payment-1' }),
          findUnique: jest.fn().mockResolvedValue({
            id: 'payment-1',
            amount: new Prisma.Decimal('75.00'),
            currency: 'GHS',
            purpose: 'WALLET_TOP_UP',
            studentId: 'student-1',
            status: PaymentStatus.SUCCEEDED,
            attempts: [],
            allocations: [],
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        paymentProviderAttempt: { update: jest.fn().mockResolvedValue({}) },
        wallet: { upsert: jest.fn().mockResolvedValue({ studentId: 'student-1', currency: 'GHS' }) },
        walletTransaction: {
          findUnique: walletTransactionFind,
          create: jest.fn(),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        $executeRaw: jest.fn().mockResolvedValue([]),
      })),
    };

    const processor = new PaymentWebhookProcessor(prisma as any);
    await expect(processor.apply({ ...normalized, amount: '75.00' }, 'event-2'))
      .resolves.toMatchObject({ applied: true, paymentId: 'payment-1', status: PaymentStatus.SUCCEEDED });

    expect(walletTransactionFind).toHaveBeenCalledWith({ where: { paymentId: 'payment-1' }, select: expect.any(Object) });
  });

});
