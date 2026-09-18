import { ForbiddenException } from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { StationeryService } from './stationery.service';

function makeTx(): any {
  return {
    stationeryItem: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    stockMovement: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    guardian: { findUnique: jest.fn() },
    guardianStudent: { findUnique: jest.fn() },
    stationeryOrder: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    idempotencyKey: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    payment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    paymentProviderAttempt: { create: jest.fn(), update: jest.fn() },
    person: { findUnique: jest.fn() },
  };
}

describe('StationeryService', () => {
  it('blocks stock management for teachers', async () => {
    const service = new StationeryService({} as never, {} as never);
    await expect(service.createItem({ sku: 'PEN-01', name: 'Pen', price: 2 }, 'teacher', [RoleName.TEACHER]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a guardian link with canPayFees for draft orders', async () => {
    const tx = makeTx();
    tx.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    tx.guardianStudent.findUnique.mockResolvedValue({ canPayFees: false });
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new StationeryService(prisma as never, {} as never);

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
    const service = new StationeryService(prisma as never, {} as never);

    await expect(service.createDraftOrder({ studentId: 'student-1', lines: [{ itemId: 'item-1', quantity: 1 }] }, 'guardian-user', [RoleName.GUARDIAN]))
      .resolves.toMatchObject({ status: 'DRAFT' });
    expect(tx.stationeryItem.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });  it('requires an idempotency key for stationery payment initiation', async () => {
    const tx = makeTx();
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new StationeryService(prisma as never, {} as never);
    await expect(service.initiatePayment('order-1', {}, 'guardian-user', [RoleName.GUARDIAN], ''))
      .rejects.toBeInstanceOf(require('@nestjs/common').ConflictException);
  });

  it('reserves the stationery payment before provider initiation', async () => {
    const tx = makeTx();
    tx.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    tx.stationeryOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNumber: 'ST-1', studentId: 'student-1', guardianId: 'guardian-1',
      status: 'DRAFT', totalAmount: new Prisma.Decimal('20.00'), paymentId: null,
    });
    tx.person.findUnique.mockResolvedValue({ firstName: 'Ama', lastName: 'Parent', phone: '0244000000' });
    tx.payment = { create: jest.fn().mockResolvedValue({
      id: 'payment-1', studentId: 'student-1', guardianId: 'guardian-1',
      amount: new Prisma.Decimal('20.00'), currency: 'GHS', status: 'PENDING',
      purpose: 'STATIONERY', clientReference: 'bci-stationery-order-1-ref',
    }), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) };
    tx.paymentProviderAttempt = { create: jest.fn().mockResolvedValue({ id: 'attempt-1' }), update: jest.fn() };
    tx.stationeryOrder.update.mockResolvedValue({});
    tx.idempotencyKey.findUnique.mockResolvedValue(null);
    tx.idempotencyKey.create.mockResolvedValue({});
    tx.idempotencyKey.update.mockResolvedValue({});
    tx.auditLog.create.mockResolvedValue({});
    const moolre = { provider: 'MOOLRE', initiatePayment: jest.fn().mockResolvedValue({ providerReference: 'm-ref-1', requiresOtp: false, mock: true }) };
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)), idempotencyKey: { findUnique: jest.fn() } };
    const service = new StationeryService(prisma as never, moolre as never);
    const result = await service.initiatePayment('order-1', { network: 'Telecel' }, 'guardian-user', [RoleName.GUARDIAN], 'key-1');
    expect(result).toMatchObject({ paymentId: 'payment-1', orderId: 'order-1', status: 'PROCESSING' });
    expect(moolre.initiatePayment).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'STATIONERY', amount: '20.00' }));
  });


});
