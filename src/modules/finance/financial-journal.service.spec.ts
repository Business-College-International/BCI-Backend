import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinancialJournalService } from './financial-journal.service';

describe('FinancialJournalService', () => {
  it('rejects an unbalanced journal transaction before persistence', async () => {
    const prisma = { $transaction: jest.fn() } as any;
    const service = new FinancialJournalService(prisma);
    await expect(service.recordBalancedEntry([
      { accountCode: 'CASH', direction: 'DEBIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p1' },
      { accountCode: 'FEES', direction: 'CREDIT', amount: '90.00', referenceType: 'Payment', referenceId: 'p1' },
    ])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes all balanced lines atomically', async () => {
    const create = jest.fn().mockImplementation(({ data }) => data);
    const prisma = { $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({ financialJournalEntry: { create } })) } as any;
    const service = new FinancialJournalService(prisma);
    const result = await service.recordBalancedEntry([
      { accountCode: 'CASH', direction: 'DEBIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p1' },
      { accountCode: 'FEES', direction: 'CREDIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p1' },
    ], 'user-1');
    expect(result).toHaveLength(2);
    expect(result[0].amount).toEqual(new Prisma.Decimal('100.00'));
    expect(result[0].entryNumber).toEqual(result[1].entryNumber);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
