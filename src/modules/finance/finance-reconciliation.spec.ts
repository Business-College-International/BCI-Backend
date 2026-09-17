import { ForbiddenException } from '@nestjs/common';
import { RoleName, Prisma } from '@prisma/client';
import { FinanceService } from './finance.service';

function decimal(value: string) {
  return new Prisma.Decimal(value);
}

describe('FinanceService reconciliation reads', () => {
  it('blocks a guardian without fee permission from receipt history', async () => {
    const prisma = {
      guardian: { findUnique: jest.fn().mockResolvedValue({ personId: 'guardian-1' }) },
      guardianStudent: {
        findUnique: jest.fn().mockResolvedValue({ canPayFees: false }),
      },
    };
    const service = new FinanceService(prisma as never);

    await expect(
      service.listStudentReceipts('student-1', 'guardian-user', [RoleName.GUARDIAN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('counts only successful payments as collected in the finance summary', async () => {
    const prisma = {
      studentInvoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'invoice-1',
            status: 'PARTIALLY_PAID',
            lines: [{ amountDue: decimal('100.00') }],
            allocations: [{ amount: decimal('40.00'), payment: { status: 'SUCCEEDED', refunds: [] } }],
          },
        ]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          { status: 'SUCCEEDED', amount: decimal('40.00'), refunds: [] },
          { status: 'PENDING', amount: decimal('30.00'), refunds: [] },
          { status: 'PROCESSING', amount: decimal('20.00'), refunds: [] },
        ]),
      },
    };
    const service = new FinanceService(prisma as never);

    const summary = await service.getFinanceSummary({}, 'accountant-user', [RoleName.ACCOUNTANT]);

    expect(summary.payments.collectedAmount).toBe('40.00');
    expect(summary.payments.pendingAmount).toBe('50.00');
    expect(summary.invoices.outstandingAmount).toBe('60.00');
  });
});
