import { Prisma, PaymentPurpose } from '@prisma/client';
import { FinancialJournalService } from './financial-journal.service';

describe('FinancialJournalService payment settlement mapping', () => {
  it.each([
    [PaymentPurpose.FEE, 'FEES'],
    [PaymentPurpose.WALLET_TOP_UP, 'WALLET_LIABILITY'],
    [PaymentPurpose.STATIONERY, 'STATIONERY_REVENUE'],
  ])('maps %s to the correct credit account', async (purpose, expectedAccount) => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue([]),
      financialJournalEntry: {
        create: jest.fn().mockImplementation(({ data }) => data),
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as any;

    const service = new FinancialJournalService({} as any);
    await service.recordPaymentSettlement({
      id: 'payment-1',
      purpose,
      amount: new Prisma.Decimal('25.00'),
      currency: 'GHS',
    }, 'user-1', tx);

    expect(tx.financialJournalEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountCode: expectedAccount,
        direction: 'CREDIT',
        referenceType: 'Payment',
        referenceId: 'payment-1',
      }),
    }));
  });
});
