import { ForbiddenException } from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { StationeryService } from './stationery.service';

function makeTx() {
  return {
    stationeryItem: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    stockMovement: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    guardian: { findUnique: jest.fn() },
    guardianStudent: { findUnique: jest.fn() },
    stationeryOrder: { create: jest.fn(), findMany: jest.fn() },
  };
}

describe('StationeryService', () => {
  it('blocks stock management for teachers', async () => {
    const service = new StationeryService({} as never);
    await expect(service.createItem({ sku: 'PEN-01', name: 'Pen', price: 2 }, 'teacher', [RoleName.TEACHER]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a guardian link with canPayFees for draft orders', async () => {
    const tx = makeTx();
    tx.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    tx.guardianStudent.findUnique.mockResolvedValue({ canPayFees: false });
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new StationeryService(prisma as never);

    await expect(service.createDraftOrder({ studentId: 'student-1', lines: [{ itemId: 'item-1', quantity: 1 }] }, 'guardian-user', [RoleName.GUARDIAN]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('builds a draft order without mutating stock', async () => {
    const tx = makeTx();
    tx.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    tx.guardianStudent.findUnique.mockResolvedValue({ canPayFees: true });
    tx.stationeryItem.findMany.mockResolvedValue([{ id: 'item-1', sku: 'PEN-01', name: 'Pen', price: new Prisma.Decimal(2) }]);
    tx.stationeryOrder.create.mockResolvedValue({ id: 'order-1', status: 'DRAFT' });
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new StationeryService(prisma as never);

    await expect(service.createDraftOrder({ studentId: 'student-1', lines: [{ itemId: 'item-1', quantity: 1 }] }, 'guardian-user', [RoleName.GUARDIAN]))
      .resolves.toMatchObject({ status: 'DRAFT' });
    expect(tx.stationeryItem.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
});
