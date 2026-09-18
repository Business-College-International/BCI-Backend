import { Prisma, WalletTransactionDirection, WalletTransactionType } from '@prisma/client';

describe('wallet ledger contract', () => {
  it('keeps credits and debits explicit even when their transaction types differ', () => {
    const entries = [
      { type: WalletTransactionType.TOP_UP, direction: WalletTransactionDirection.CREDIT, amount: new Prisma.Decimal('100') },
      { type: WalletTransactionType.WITHDRAWAL, direction: WalletTransactionDirection.DEBIT, amount: new Prisma.Decimal('25') },
    ];

    const balance = entries.reduce((total, entry) => (
      entry.direction === WalletTransactionDirection.CREDIT
        ? total.plus(entry.amount)
        : total.minus(entry.amount)
    ), new Prisma.Decimal(0));

    expect(balance.toFixed(2)).toBe('75.00');
  });
});
