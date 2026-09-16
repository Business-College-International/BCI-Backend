import { ConflictException } from '@nestjs/common';
import { Prisma, RoleName, WalletTransactionType } from '@prisma/client';
import { WalletOperationsService } from './wallet-operations.service';

describe('WalletOperationsService', () => {
  const tx = {
    wallet: { findUnique: jest.fn() },
    walletTransaction: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  } as any;
  const prisma = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('rejects withdrawals above the calculated balance', async () => {
    tx.wallet.findUnique.mockResolvedValue({
      studentId: 'student-1',
      currency: 'GHS',
      transactions: [
        { id: 'top-up', type: WalletTransactionType.TOP_UP, amount: new Prisma.Decimal('100') },
      ],
    });

    await expect(
      new WalletOperationsService(prisma).withdraw(
        'student-1',
        { amount: 100.01 },
        'user-1',
        [RoleName.OFFICE],
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
  });

  it('blocks wallets containing unresolved reversal transactions', async () => {
    tx.wallet.findUnique.mockResolvedValue({
      studentId: 'student-1',
      currency: 'GHS',
      transactions: [
        { id: 'reversal', type: WalletTransactionType.REVERSAL, amount: new Prisma.Decimal('10') },
      ],
    });

    await expect(
      new WalletOperationsService(prisma).withdraw(
        'student-1',
        { amount: 10 },
        'user-1',
        [RoleName.ACCOUNTANT],
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('creates an atomic withdrawal and returns the remaining balance', async () => {
    tx.wallet.findUnique.mockResolvedValue({
      studentId: 'student-1',
      currency: 'GHS',
      transactions: [
        { id: 'top-up', type: WalletTransactionType.TOP_UP, amount: new Prisma.Decimal('150') },
        { id: 'old-withdrawal', type: WalletTransactionType.WITHDRAWAL, amount: new Prisma.Decimal('25') },
      ],
    });
    tx.walletTransaction.create.mockResolvedValue({ id: 'new-withdrawal', amount: new Prisma.Decimal('50') });

    await expect(
      new WalletOperationsService(prisma).withdraw(
        'student-1',
        { amount: 50, note: 'Student office withdrawal' },
        'user-1',
        [RoleName.OFFICE],
      ),
    ).resolves.toMatchObject({
      transactionId: 'new-withdrawal',
      balance: '75.00',
      status: 'COMPLETED',
    });

    expect(tx.walletTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: 'student-1',
        type: WalletTransactionType.WITHDRAWAL,
        amount: new Prisma.Decimal('50'),
        processedBy: 'user-1',
      }),
    });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});
