import { ConflictException } from '@nestjs/common';
import { Prisma, RoleName, WalletTransactionDirection, WalletTransactionType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { WalletOperationsService } from './wallet-operations.service';

describe('WalletOperationsService', () => {
  const tx = {
    idempotencyKey: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ studentId: 'student-1' }]),
    wallet: { findUnique: jest.fn() },
    walletTransaction: { create: jest.fn() },
    walletWithdrawal: { create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  } as any;
  const prisma = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ studentId: 'student-1' }]);
    tx.idempotencyKey.findUnique.mockResolvedValue(null);
    tx.idempotencyKey.create.mockResolvedValue({});
    tx.idempotencyKey.update.mockResolvedValue({});
  });

  it('requires an idempotency key for withdrawals', async () => {
    await expect(
      new WalletOperationsService(prisma).withdraw(
        'student-1',
        { amount: 10 },
        'user-1',
        [RoleName.OFFICE],
        '',
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.wallet.findUnique).not.toHaveBeenCalled();
  });

  it('rejects withdrawal retries that reuse a key with different parameters', async () => {
    tx.idempotencyKey.findUnique.mockResolvedValue({ requestHash: 'different-request', responseJson: null });

    await expect(
      new WalletOperationsService(prisma).withdraw(
        'student-1',
        { amount: 10 },
        'user-1',
        [RoleName.OFFICE],
        'withdrawal-key-1',
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it('replays a completed withdrawal without creating another wallet transaction', async () => {
    const requestHash = createHash('sha256')
      .update(JSON.stringify({
        studentId: 'student-1',
        amount: 50,
        note: 'Student office withdrawal',
      }))
      .digest('hex');

    tx.idempotencyKey.findUnique.mockResolvedValue({
      requestHash,
      responseJson: {
        transactionId: 'existing-withdrawal',
        studentId: 'student-1',
        amount: '50',
        currency: 'GHS',
        balance: '75.00',
        status: 'COMPLETED',
      },
    });

    await expect(
      new WalletOperationsService(prisma).withdraw(
        'student-1',
        { amount: 50, note: 'Student office withdrawal' },
        'user-1',
        [RoleName.OFFICE],
        'withdrawal-key-2',
      ),
    ).resolves.toMatchObject({ transactionId: 'existing-withdrawal', balance: '75.00' });
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it('rejects withdrawals above the calculated balance', async () => {
    tx.wallet.findUnique.mockResolvedValue({
      studentId: 'student-1',
      currency: 'GHS',
      transactions: [
        { id: 'top-up', type: WalletTransactionType.TOP_UP, direction: WalletTransactionDirection.CREDIT, amount: new Prisma.Decimal('100'), reversalOfId: null, paymentId: 'payment-1', withdrawalId: null },
      ],
    });

    await expect(
      new WalletOperationsService(prisma).withdraw(
        'student-1',
        { amount: 100.01 },
        'user-1',
        [RoleName.OFFICE],
        'withdrawal-key-3',
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it('blocks wallets containing unresolved reversal transactions', async () => {
    tx.wallet.findUnique.mockResolvedValue({
      studentId: 'student-1',
      currency: 'GHS',
      transactions: [
        { id: 'reversal', type: WalletTransactionType.REVERSAL, direction: null, amount: new Prisma.Decimal('10'), reversalOfId: null, paymentId: null },
      ],
    });

    await expect(
      new WalletOperationsService(prisma).withdraw(
        'student-1',
        { amount: 10 },
        'user-1',
        [RoleName.ACCOUNTANT],
        'withdrawal-key-4',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('creates an atomic withdrawal, records idempotency, and returns the remaining balance', async () => {
    tx.wallet.findUnique.mockResolvedValue({
      studentId: 'student-1',
      currency: 'GHS',
      transactions: [
        { id: 'top-up', type: WalletTransactionType.TOP_UP, direction: WalletTransactionDirection.CREDIT, amount: new Prisma.Decimal('150'), reversalOfId: null, paymentId: 'payment-1' },
        { id: 'old-withdrawal', type: WalletTransactionType.WITHDRAWAL, direction: WalletTransactionDirection.DEBIT, amount: new Prisma.Decimal('25'), reversalOfId: null, paymentId: null },
      ],
    });
    tx.walletTransaction.create.mockResolvedValue({ id: 'new-withdrawal', amount: new Prisma.Decimal('50') });
    tx.walletWithdrawal.create.mockResolvedValue({ id: 'withdrawal-1', status: 'DISPENSED' });

    await expect(
      new WalletOperationsService(prisma).withdraw(
        'student-1',
        { amount: 50, note: 'Student office withdrawal' },
        'user-1',
        [RoleName.OFFICE],
        'withdrawal-key-5',
      ),
    ).resolves.toMatchObject({
      transactionId: 'new-withdrawal',
      balance: '75.00',
      status: 'COMPLETED',
    });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.walletWithdrawal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: 'student-1',
        amount: new Prisma.Decimal('50'),
        status: 'DISPENSED',
        requestedBy: 'user-1',
        approvedBy: 'user-1',
        verifiedBy: 'user-1',
        requestedAt: expect.any(Date),
        approvedAt: expect.any(Date),
        verifiedAt: expect.any(Date),
        dispensedAt: expect.any(Date),
      }),
    });
    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: 'student-1',
        type: WalletTransactionType.WITHDRAWAL,
        direction: WalletTransactionDirection.DEBIT,
        amount: new Prisma.Decimal('50'),
        withdrawalId: 'withdrawal-1',
        processedBy: 'user-1',
      }),
    });
    expect(tx.idempotencyKey.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statusCode: 200, responseJson: expect.objectContaining({ transactionId: 'new-withdrawal' }) }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it('reverses a signed credit exactly once and returns the adjusted balance', async () => {
    tx.wallet.findUnique.mockResolvedValue({
      studentId: 'student-1',
      currency: 'GHS',
      transactions: [
        { id: 'top-up', type: WalletTransactionType.TOP_UP, direction: WalletTransactionDirection.CREDIT, amount: new Prisma.Decimal('100'), reversalOfId: null, paymentId: 'payment-1' },
      ],
    });
    tx.walletTransaction.create.mockResolvedValue({
      id: 'reversal-1',
      amount: new Prisma.Decimal('100'),
    });
    tx.walletWithdrawal.update.mockResolvedValue({});

    await expect(
      new WalletOperationsService(prisma).reverse(
        'student-1',
        'top-up',
        { reason: 'Provider payment was duplicated.' },
        'user-1',
        [RoleName.OFFICE],
        'reversal-key-1',
      ),
    ).resolves.toMatchObject({
      transactionId: 'reversal-1',
      reversalOfId: 'top-up',
      direction: WalletTransactionDirection.DEBIT,
      balance: '0.00',
    });
  });

  it('blocks a reversal that would create a negative wallet balance', async () => {
    tx.wallet.findUnique.mockResolvedValue({
      studentId: 'student-1',
      currency: 'GHS',
      transactions: [
        { id: 'top-up', type: WalletTransactionType.TOP_UP, direction: WalletTransactionDirection.CREDIT, amount: new Prisma.Decimal('50'), reversalOfId: null, paymentId: 'payment-1' },
        { id: 'withdrawal', type: WalletTransactionType.WITHDRAWAL, direction: WalletTransactionDirection.DEBIT, amount: new Prisma.Decimal('50'), reversalOfId: null, paymentId: null },
      ],
    });

    await expect(
      new WalletOperationsService(prisma).reverse(
        'student-1',
        'top-up',
        { reason: 'Duplicate provider settlement.' },
        'user-1',
        [RoleName.ACCOUNTANT],
        'reversal-key-2',
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it('does not reverse an already reversed transaction', async () => {
    tx.wallet.findUnique.mockResolvedValue({
      studentId: 'student-1',
      currency: 'GHS',
      transactions: [
        { id: 'top-up', type: WalletTransactionType.TOP_UP, direction: WalletTransactionDirection.CREDIT, amount: new Prisma.Decimal('50'), reversalOfId: null, paymentId: 'payment-1' },
        { id: 'reversal-1', type: WalletTransactionType.REVERSAL, direction: WalletTransactionDirection.DEBIT, amount: new Prisma.Decimal('50'), reversalOfId: 'top-up', paymentId: null },
      ],
    });

    await expect(
      new WalletOperationsService(prisma).reverse(
        'student-1',
        'top-up',
        { reason: 'Second correction.' },
        'user-1',
        [RoleName.OFFICE],
        'reversal-key-3',
      ),
    ).rejects.toThrow(ConflictException);
  });

});