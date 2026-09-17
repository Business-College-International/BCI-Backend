import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ExpenseStatus, Prisma, RoleName } from '@prisma/client';
import { createHash } from 'node:crypto';
import { FinanceExpenseService } from './finance-expense.service';

function makeTx() {
  return {
    idempotencyKey: { upsert: jest.fn(), update: jest.fn() },
    expense: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
}

function requestHash(dto: { category: string; amount: number; description?: string; receiptUrl?: string }) {
  return createHash('sha256').update(JSON.stringify({
    category: dto.category.trim(),
    amount: new Prisma.Decimal(dto.amount).toFixed(2),
    description: dto.description?.trim() || null,
    receiptUrl: dto.receiptUrl?.trim() || null,
  })).digest('hex');
}

describe('FinanceExpenseService', () => {
  it('prevents a teacher from entering expenses', async () => {
    const service = new FinanceExpenseService({} as never);
    await expect(service.create({ category: 'Transport', amount: 100 }, 'teacher', [RoleName.TEACHER], 'expense-key-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires an idempotency key for expense creation', async () => {
    const service = new FinanceExpenseService({} as never);
    await expect(service.create({ category: 'Transport', amount: 100 }, 'office', [RoleName.OFFICE], ''))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects reuse of an expense idempotency key with different parameters', async () => {
    const tx = makeTx();
    tx.idempotencyKey.upsert.mockResolvedValue({ requestHash: 'different-request', responseJson: null, statusCode: null });
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new FinanceExpenseService(prisma as never);

    await expect(service.create({ category: 'Transport', amount: 100 }, 'office', [RoleName.OFFICE], 'expense-key-2'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.expense.create).not.toHaveBeenCalled();
  });

  it('replays a completed expense without creating another record', async () => {
    const dto = { category: 'Fuel', amount: 1234.5, description: 'Generator fuel' };
    const response = { id: 'e-existing', category: 'Fuel', amount: '1234.50', status: ExpenseStatus.DRAFT };
    const tx = makeTx();
    tx.idempotencyKey.upsert.mockResolvedValue({ requestHash: requestHash(dto), responseJson: response, statusCode: 201 });
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new FinanceExpenseService(prisma as never);

    await expect(service.create(dto, 'office', [RoleName.OFFICE], 'expense-key-3'))
      .resolves.toMatchObject({ id: 'e-existing', amount: '1234.50' });
    expect(tx.expense.create).not.toHaveBeenCalled();
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
    const dto = { category: 'Fuel', amount: 1234.5 };
    const tx = makeTx();
    tx.idempotencyKey.upsert.mockResolvedValue({ requestHash: requestHash(dto), responseJson: null, statusCode: null });
    tx.expense.create.mockResolvedValue({
      id: 'e1', category: 'Fuel', amount: new Prisma.Decimal('1234.50'), currency: 'GHS', description: null,
      receiptUrl: null, enteredBy: 'office', approvedBy: null, status: ExpenseStatus.DRAFT,
      createdAt: new Date('2026-09-15T00:00:00Z'), approvedAt: null, paidAt: null,
    });
    tx.auditLog.create.mockResolvedValue({});
    tx.idempotencyKey.update.mockResolvedValue({});
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new FinanceExpenseService(prisma as never);

    await expect(service.create(dto, 'office', [RoleName.OFFICE], 'expense-key-4'))
      .resolves.toMatchObject({ amount: '1234.50' });
    expect(tx.idempotencyKey.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ statusCode: 201, responseJson: expect.objectContaining({ id: 'e1', amount: '1234.50' }) }),
    }));
  });
});
