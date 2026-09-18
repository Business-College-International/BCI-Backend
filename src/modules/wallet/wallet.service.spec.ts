import { ForbiddenException } from '@nestjs/common';
import { Prisma, RoleName, WalletTransactionDirection, WalletTransactionType } from '@prisma/client';
import { WalletService } from './wallet.service';

describe('WalletService ledger balance', () => {
  function makePrisma() {
    return {
      student: { findUnique: jest.fn() },
      guardian: { findUnique: jest.fn() },
      wallet: { findUnique: jest.fn() },
      walletTransaction: { findMany: jest.fn() },
    } as any;
  }

  const student = {
    id: 'student-1',
    admissionNumber: 'BCI-001',
    firstName: 'Ama',
    lastName: 'Doe',
    status: 'ACTIVE',
  };

  it('derives balance from explicit signed effects, not transaction type', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue(student);
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.wallet.findUnique.mockResolvedValue({ studentId: 'student-1', currency: 'GHS' });
    prisma.walletTransaction.findMany
      .mockResolvedValueOnce([
        { id: 'withdrawal', type: WalletTransactionType.WITHDRAWAL, direction: WalletTransactionDirection.DEBIT, amount: new Prisma.Decimal('25'), reversalOfId: null, paymentId: null, providerReference: null, processedBy: 'office-1', createdAt: new Date('2026-09-18'), note: 'Withdrawal' },
        { id: 'topup', type: WalletTransactionType.TOP_UP, direction: WalletTransactionDirection.CREDIT, amount: new Prisma.Decimal('100'), reversalOfId: null, paymentId: 'payment-1', providerReference: 'provider-1', processedBy: null, createdAt: new Date('2026-09-17'), note: 'Top up' },
      ])
      .mockResolvedValueOnce([
        { id: 'topup', type: WalletTransactionType.TOP_UP, direction: WalletTransactionDirection.CREDIT, amount: new Prisma.Decimal('100'), reversalOfId: null, paymentId: 'payment-1' },
        { id: 'withdrawal', type: WalletTransactionType.WITHDRAWAL, direction: WalletTransactionDirection.DEBIT, amount: new Prisma.Decimal('25'), reversalOfId: null, paymentId: null },
      ]);

    const result = await new WalletService(prisma).getStudentWallet('student-1', 'guardian-user', [RoleName.GUARDIAN]);

    expect(result.balance).toBe('75.00');
    expect(result.balanceStatus).toBe('CALCULATED');
    expect(result.transactions[0]).toMatchObject({
      direction: WalletTransactionDirection.DEBIT,
      reversalOfId: null,
      paymentId: null,
    });
  });

  it('requires ledger policy when a reversal has no explicit signed reference', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue(student);
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.wallet.findUnique.mockResolvedValue({ studentId: 'student-1', currency: 'GHS' });
    prisma.walletTransaction.findMany
      .mockResolvedValueOnce([
        { id: 'reversal', type: WalletTransactionType.REVERSAL, direction: null, amount: new Prisma.Decimal('10'), reversalOfId: null, paymentId: null, providerReference: null, processedBy: 'office-1', createdAt: new Date('2026-09-18'), note: 'Legacy reversal' },
      ])
      .mockResolvedValueOnce([
        { id: 'reversal', type: WalletTransactionType.REVERSAL, direction: null, amount: new Prisma.Decimal('10'), reversalOfId: null, paymentId: null },
      ]);

    const result = await new WalletService(prisma).getStudentWallet('student-1', 'guardian-user', [RoleName.GUARDIAN]);

    expect(result.balance).toBeNull();
    expect(result.balanceStatus).toBe('LEDGER_POLICY_REQUIRED');
  });

  it('enforces guardian wallet relationship capability before reading the ledger', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue(student);
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.wallet.findUnique.mockResolvedValue({ studentId: 'student-1', currency: 'GHS' });

    await expect(
      new WalletService(prisma).getStudentWallet('student-1', 'guardian-user', [RoleName.GUARDIAN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
