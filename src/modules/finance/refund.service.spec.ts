import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { InvoiceStatus, PaymentPurpose, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { RefundService } from './refund.service';

function mockPrisma() {
  return {
    payment: { findUnique: jest.fn() },
    refund: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
    person: { findUnique: jest.fn() },
    guardianStudent: { findFirst: jest.fn() },
    studentInvoice: { findUnique: jest.fn(), update: jest.fn() },
    financialJournalEntry: { findMany: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  } as any;
}

function mockDeps() {
  return {
    disbursements: {
      initiateTransfer: jest.fn(),
      getTransferStatus: jest.fn(),
    },
    journal: {
      recordBalancedEntry: jest.fn(),
    },
  } as any;
}

function makeProcessingRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    status: PaymentStatus.PROCESSING,
    approvedBy: 'approver-1',
    amount: new Prisma.Decimal('40.00'),
    providerReference: 'moolre-ref-1',
    paymentId: 'payment-1',
    payment: {
      id: 'payment-1',
      status: PaymentStatus.SUCCEEDED,
      amount: new Prisma.Decimal('100.00'),
      currency: 'GHS',
      purpose: PaymentPurpose.FEE,
      refunds: [{ id: 'refund-1', amount: new Prisma.Decimal('40.00'), status: PaymentStatus.PROCESSING }],
      allocations: [{
        invoiceId: 'invoice-1',
        amount: new Prisma.Decimal('100.00'),
        invoice: {
          id: 'invoice-1',
          status: InvoiceStatus.PAID,
          lines: [{ amountDue: new Prisma.Decimal('100.00') }],
        },
      }],
    },
    ...overrides,
  };
}

describe('RefundService', () => {
  it('rejects refund amounts above the remaining refundable payment amount', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    const tx = prisma;
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      status: PaymentStatus.SUCCEEDED,
      amount: new Prisma.Decimal('100.00'),
      purpose: PaymentPurpose.FEE,
      allocations: [{ id: 'allocation-1', invoiceId: 'invoice-1', amount: new Prisma.Decimal('100.00') }],
      refunds: [{ amount: new Prisma.Decimal('60.00'), status: PaymentStatus.SUCCEEDED }],
    });
    const service = new RefundService(prisma, deps.disbursements, deps.journal);
    await expect(service.requestRefund({ paymentId: 'payment-1', amount: '41.00', reason: 'Duplicate payment' }, 'user-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('locks the payment row before calculating refundable capacity', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    const tx = prisma;
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      status: PaymentStatus.SUCCEEDED,
      amount: new Prisma.Decimal('100.00'),
      purpose: PaymentPurpose.FEE,
      allocations: [{ id: 'allocation-1', invoiceId: 'invoice-1', amount: new Prisma.Decimal('100.00') }],
      refunds: [],
    });
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', status: PaymentStatus.PENDING, amount: new Prisma.Decimal('40.00') });
    prisma.auditLog.create.mockResolvedValue({});

    const service = new RefundService(prisma, deps.disbursements, deps.journal);
    await service.requestRefund(
      { paymentId: 'payment-1', amount: '40.00', reason: 'Duplicate payment' },
      'user-1',
      [RoleName.ACCOUNTANT],
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('runs refund reservation under serializable isolation', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown, options: unknown) => {
      expect(options).toEqual(expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
      return callback(prisma);
    });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: new Prisma.Decimal('100.00'), purpose: PaymentPurpose.FEE,
      allocations: [{ id: 'allocation-1', invoiceId: 'invoice-1', amount: new Prisma.Decimal('100.00') }], refunds: [],
    });
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', paymentId: 'payment-1', amount: new Prisma.Decimal('40.00'), reason: 'Duplicate payment', requestedBy: 'user-1', status: PaymentStatus.PENDING });
    const service = new RefundService(prisma, deps.disbursements, deps.journal);

    await service.requestRefund({ paymentId: 'payment-1', amount: '40.00', reason: 'Duplicate payment' }, 'user-1', [RoleName.ACCOUNTANT]);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }));
  });

  it('translates a refund serialization conflict into a retryable conflict response', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    const service = new RefundService(prisma, deps.disbursements, deps.journal);

    await expect(service.requestRefund({ paymentId: 'payment-1', amount: '40.00', reason: 'Duplicate payment' }, 'user-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents refund self-approval', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique.mockResolvedValue({ id: 'refund-1', status: PaymentStatus.PENDING, requestedBy: 'user-1', approvedBy: null });
    const service = new RefundService(prisma, deps.disbursements, deps.journal);
    await expect(service.approveRefund('refund-1', 'user-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an approval race when another approver wins the conditional transition', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique.mockResolvedValue({ id: 'refund-1', status: PaymentStatus.PENDING, requestedBy: 'requester', approvedBy: null });
    prisma.refund.updateMany.mockResolvedValue({ count: 0 });
    const service = new RefundService(prisma, deps.disbursements, deps.journal);

    await expect(service.approveRefund('refund-1', 'approver-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('records a successful conditional approval and returns the persisted refund', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique
      .mockResolvedValueOnce({ id: 'refund-1', status: PaymentStatus.PENDING, requestedBy: 'requester', approvedBy: null })
      .mockResolvedValueOnce({ id: 'refund-1', status: PaymentStatus.PENDING, requestedBy: 'requester', approvedBy: 'approver-1' });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    const service = new RefundService(prisma, deps.disbursements, deps.journal);

    const result = await service.approveRefund('refund-1', 'approver-1', [RoleName.ACCOUNTANT]);

    expect(result.approvedBy).toBe('approver-1');
    expect(prisma.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund-1', status: PaymentStatus.PENDING, approvedBy: null },
    }));
  });

  it('moves an approved refund to processing and records the provider reference', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique.mockResolvedValue({
      id: 'refund-1', status: PaymentStatus.PENDING, approvedBy: 'approver-1',
      amount: new Prisma.Decimal('25.00'),
      payment: { id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: new Prisma.Decimal('25.00'), purpose: PaymentPurpose.FEE, guardianId: 'guardian-1' },
    });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    prisma.person.findUnique.mockResolvedValue({ phone: '0240000000' });
    deps.disbursements.initiateTransfer.mockResolvedValue({ providerReference: 'moolre-ref-1', status: 'PENDING', mock: true });
    prisma.refund.update.mockResolvedValue({ id: 'refund-1', status: PaymentStatus.PROCESSING, providerReference: 'moolre-ref-1' });
    const service = new RefundService(prisma, deps.disbursements, deps.journal);

    const result = await service.executeRefund('refund-1', 'operator-1', [RoleName.ACCOUNTANT]);

    expect(result?.status).toBe(PaymentStatus.PROCESSING);
    expect(deps.disbursements.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({
      referenceId: 'bci-refund-refund-1',
      amountGhs: '25.00',
      recipientPhone: '0240000000',
    }));
  });

  it('keeps an ambiguous refund in processing when provider initiation and status lookup are both unavailable', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique.mockResolvedValue({
      id: 'refund-1', status: PaymentStatus.PENDING, approvedBy: 'approver-1',
      amount: new Prisma.Decimal('25.00'),
      payment: { id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: new Prisma.Decimal('25.00'), purpose: PaymentPurpose.FEE, guardianId: 'guardian-1' },
    });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    prisma.person.findUnique.mockResolvedValue({ phone: '0240000000' });
    deps.disbursements.initiateTransfer.mockRejectedValue(new Error('provider timeout after request')); 
    deps.disbursements.getTransferStatus.mockRejectedValue(new Error('status endpoint unavailable'));
    const service = new RefundService(prisma, deps.disbursements, deps.journal);

    await expect(service.executeRefund('refund-1', 'operator-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(deps.disbursements.getTransferStatus).toHaveBeenCalledWith('bci-refund-refund-1');
    expect(prisma.refund.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund-1', status: PaymentStatus.PENDING, approvedBy: { not: null } },
      data: { status: PaymentStatus.PROCESSING },
    }));
  });

  it('marks a refund failed only when provider status confirms failure after an initiation error', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique.mockResolvedValue({
      id: 'refund-1', status: PaymentStatus.PENDING, approvedBy: 'approver-1',
      amount: new Prisma.Decimal('25.00'),
      payment: { id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: new Prisma.Decimal('25.00'), purpose: PaymentPurpose.FEE, guardianId: 'guardian-1' },
    });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    prisma.person.findUnique.mockResolvedValue({ phone: '0240000000' });
    deps.disbursements.initiateTransfer.mockRejectedValue(new Error('provider timeout after request'));
    deps.disbursements.getTransferStatus.mockResolvedValue({ providerReference: 'moolre-ref-1', status: 'FAILED', mock: false });
    prisma.auditLog.create.mockResolvedValue({});
    prisma.refund.findUnique.mockResolvedValueOnce({
      id: 'refund-1', status: PaymentStatus.PENDING, approvedBy: 'approver-1',
      amount: new Prisma.Decimal('25.00'),
      payment: { id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: new Prisma.Decimal('25.00'), purpose: PaymentPurpose.FEE, guardianId: 'guardian-1' },
    }).mockResolvedValueOnce({ id: 'refund-1', status: PaymentStatus.FAILED });
    const service = new RefundService(prisma, deps.disbursements, deps.journal);

    const result = await service.executeRefund('refund-1', 'operator-1', [RoleName.ACCOUNTANT]);

    expect(result?.status).toBe(PaymentStatus.FAILED);
    expect(prisma.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund-1', status: PaymentStatus.PROCESSING },
      data: { status: PaymentStatus.FAILED },
    }));
  });

  it('does not mark a provider-accepted refund failed when local settlement fails', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique.mockResolvedValueOnce({
      id: 'refund-1', status: PaymentStatus.PENDING, approvedBy: 'approver-1', amount: new Prisma.Decimal('40.00'), paymentId: 'payment-1',
      payment: { id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: new Prisma.Decimal('100.00'), purpose: PaymentPurpose.FEE, guardianId: 'guardian-1' },
    }).mockResolvedValueOnce(makeProcessingRefund());
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    prisma.person.findUnique.mockResolvedValue({ phone: '0240000000' });
    deps.disbursements.initiateTransfer.mockResolvedValue({ providerReference: 'moolre-ref-1', status: 'SUCCESSFUL', mock: true });
    prisma.studentInvoice.findUnique.mockRejectedValue(new Error('database unavailable'));

    const service = new RefundService(prisma, deps.disbursements, deps.journal);
    await expect(service.executeRefund('refund-1', 'operator-1', [RoleName.ACCOUNTANT]))
      .rejects.toThrow('database unavailable');

    expect(prisma.refund.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund-1', status: PaymentStatus.PENDING, approvedBy: { not: null } },
      data: { status: PaymentStatus.PROCESSING },
    }));
  });

  it('settles a successful refund, reopens the invoice, and records a reversal journal', async () => {
    const prisma = mockPrisma();
    const deps = mockDeps();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    const processingRefund = makeProcessingRefund();
    const settlementRefund = makeProcessingRefund();
    prisma.refund.findUnique
      .mockResolvedValueOnce(processingRefund)
      .mockResolvedValueOnce(settlementRefund)
      .mockResolvedValueOnce({ id: 'refund-1', status: PaymentStatus.SUCCEEDED });
    prisma.refund.update.mockResolvedValue({ id: 'refund-1', status: PaymentStatus.SUCCEEDED });
    prisma.studentInvoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      status: InvoiceStatus.PAID,
      lines: [{ amountDue: new Prisma.Decimal('100.00') }],
      allocations: [{
        amount: new Prisma.Decimal('100.00'),
        payment: {
          status: PaymentStatus.SUCCEEDED,
          refunds: [{ id: 'refund-1', amount: new Prisma.Decimal('40.00'), status: PaymentStatus.SUCCEEDED }],
        },
      }],
    });
    prisma.studentInvoice.update.mockResolvedValue({ id: 'invoice-1', status: InvoiceStatus.PARTIALLY_PAID });
    prisma.auditLog.create.mockResolvedValue({});
    deps.journal.recordBalancedEntry.mockResolvedValue([]);
    deps.disbursements.getTransferStatus.mockResolvedValue({ providerReference: 'moolre-ref-1', status: 'SUCCESSFUL', mock: true });

    const service = new RefundService(prisma, deps.disbursements, deps.journal);
    const result = await service.reconcileRefund('refund-1', 'operator-1', [RoleName.ACCOUNTANT]);

    expect(result?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(prisma.studentInvoice.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invoice-1' },
      data: { status: InvoiceStatus.PARTIALLY_PAID },
    }));
    expect(deps.journal.recordBalancedEntry).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ direction: 'DEBIT', accountCode: 'FEES', amount: '40.00' }),
      expect.objectContaining({ direction: 'CREDIT', accountCode: 'CASH', amount: '40.00' }),
    ]), 'operator-1', expect.anything());
  });
});
