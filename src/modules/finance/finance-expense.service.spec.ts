import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ExpenseStatus, Prisma, RoleName } from '@prisma/client';
import { FinanceExpenseService } from './finance-expense.service';

function makeTx() {
  return {
    expense: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
}

describe('FinanceExpenseService', () => {
  it('prevents a teacher from entering expenses', async () => {
    const service = new FinanceExpenseService({} as never);
    await expect(service.create({ category: 'Transport', amount: 100 }, 'teacher', [RoleName.TEACHER]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires drafts to be submitted by their creator', async () => {
    const tx = makeTx();
    tx.expense.findUnique.mockResolvedValue({ id: 'e1', enteredBy: 'owner', status: ExpenseStatus.DRAFT });
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new FinanceExpenseService(prisma as never);

    await expect(service.submit('e1', 'other', [RoleName.OFFICE]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents the submitter from approving their own expense', async () => {
    const tx = makeTx();
    tx.expense.findUnique.mockResolvedValue({ id: 'e1', enteredBy: 'owner', status: ExpenseStatus.SUBMITTED });
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new FinanceExpenseService(prisma as never);

    await expect(service.decide('e1', 'APPROVED', 'owner', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects approval decisions outside the submitted state', async () => {
    const tx = makeTx();
    tx.expense.findUnique.mockResolvedValue({ id: 'e1', enteredBy: 'owner', status: ExpenseStatus.DRAFT });
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new FinanceExpenseService(prisma as never);

    await expect(service.decide('e1', 'APPROVED', 'approver', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('serializes expense decimals without losing monetary precision', async () => {
    const tx = makeTx();
    tx.expense.create.mockResolvedValue({
      id: 'e1', category: 'Fuel', amount: new Prisma.Decimal('1234.50'), currency: 'GHS', description: null,
      receiptUrl: null, enteredBy: 'office', approvedBy: null, status: ExpenseStatus.DRAFT,
      createdAt: new Date('2026-09-15T00:00:00Z'), approvedAt: null, paidAt: null,
    });
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new FinanceExpenseService(prisma as never);

    await expect(service.create({ category: 'Fuel', amount: 1234.5 }, 'office', [RoleName.OFFICE]))
      .resolves.toMatchObject({ amount: '1234.50' });
  });
});
