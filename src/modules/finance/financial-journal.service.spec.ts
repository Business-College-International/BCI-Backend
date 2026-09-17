import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinancialJournalService } from './financial-journal.service';

describe('FinancialJournalService', () => {
  function makePrisma() {
    return {
      financialJournalEntry: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    } as any;
  }

  it('rejects an unbalanced journal transaction before persistence', async () => {
    const prisma = makePrisma();
    const service = new FinancialJournalService(prisma);
    await expect(service.recordBalancedEntry([
      { accountCode: 'CASH', direction: 'DEBIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p1' },
      { accountCode: 'FEES', direction: 'CREDIT', amount: '90.00', referenceType: 'Payment', referenceId: 'p1' },
    ])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects journal lines with mixed transaction references', async () => {
    const prisma = makePrisma();
    const service = new FinancialJournalService(prisma);
    await expect(service.recordBalancedEntry([
      { accountCode: 'CASH', direction: 'DEBIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p1' },
      { accountCode: 'FEES', direction: 'CREDIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p2' },
    ])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes all balanced lines atomically', async () => {
    const create = jest.fn().mockImplementation(({ data }) => data);
    const tx = { financialJournalEntry: { create, findMany: jest.fn().mockResolvedValue([]) } };
    const prisma = makePrisma();
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown, options: unknown) => {
      expect(options).toEqual(expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
      return callback(tx);
    });
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

  it('returns the existing journal transaction on a replay', async () => {
    const existing = [{ id: 'line-1' }, { id: 'line-2' }];
    const tx = { financialJournalEntry: { create: jest.fn(), findMany: jest.fn().mockResolvedValue(existing) } };
    const prisma = makePrisma();
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const service = new FinancialJournalService(prisma);

    const result = await service.recordBalancedEntry([
      { accountCode: 'CASH', direction: 'DEBIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p1' },
      { accountCode: 'FEES', direction: 'CREDIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p1' },
    ]);

    expect(result).toBe(existing);
    expect(tx.financialJournalEntry.create).not.toHaveBeenCalled();
  });

  it('translates a serialization conflict into a retryable conflict response', async () => {
    const prisma = makePrisma();
    prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    const service = new FinancialJournalService(prisma);
    await expect(service.recordBalancedEntry([
      { accountCode: 'CASH', direction: 'DEBIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p1' },
      { accountCode: 'FEES', direction: 'CREDIT', amount: '100.00', referenceType: 'Payment', referenceId: 'p1' },
    ])).rejects.toBeInstanceOf(ConflictException);
  });
});
