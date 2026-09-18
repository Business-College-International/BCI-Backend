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
        { id: 'top-up', type: WalletTransactionType.TOP_UP, direction: WalletTransactionDirection.CREDIT, amount: new Prisma.Decimal('100'), reversalOfId: null, paymentId: 'payment-1' },
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

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: 'student-1',
        type: WalletTransactionType.WITHDRAWAL,
        direction: WalletTransactionDirection.DEBIT,
        amount: new Prisma.Decimal('50'),
        processedBy: 'user-1',
      }),
    });
    expect(tx.idempotencyKey.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statusCode: 200, responseJson: expect.objectContaining({ transactionId: 'new-withdrawal' }) }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});
