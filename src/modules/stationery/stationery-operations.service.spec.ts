import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StationeryOperationsService } from './stationery-operations.service';

describe('StationeryOperationsService', () => {
  const tx = {
    stationeryOrder: { findUnique: jest.fn(), update: jest.fn() },
    payment: { findUnique: jest.fn() },
    stationeryItem: { findUnique: jest.fn(), updateMany: jest.fn() },
    stockMovement: { create: jest.fn() },
    auditLog: { create: jest.fn() },
  } as any;
  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
  const service = new StationeryOperationsService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('rejects fulfillment without a linked payment', async () => {
    tx.stationeryOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ST-1',
      status: 'PAID',
      paymentId: null,
      lines: [],
    });

    await expect(service.markReadyForCollection('order-1', 'actor-1', ['OFFICE' as any])).rejects.toThrow(BadRequestException);
  });

  it('rejects a linked payment with the wrong purpose', async () => {
    tx.stationeryOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNumber: 'ST-1', status: 'PAID', paymentId: 'pay-1', lines: [],
    });
    tx.payment.findUnique.mockResolvedValue({
      id: 'pay-1', status: 'SUCCEEDED', purpose: 'FEE', amount: new Prisma.Decimal('10.00'), studentId: 'student-1',
    });

    await expect(service.markReadyForCollection('order-1', 'actor-1', ['OFFICE' as any])).rejects.toThrow(ConflictException);
  });

  it('rejects fulfillment when stock is insufficient', async () => {
    tx.stationeryOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNumber: 'ST-1', status: 'PAID', paymentId: 'pay-1', studentId: 'student-1',
      totalAmount: new Prisma.Decimal('10.00'),
      lines: [{ itemId: 'item-1', quantity: 3, unitPrice: new Prisma.Decimal('2.00'), lineTotal: new Prisma.Decimal('6.00') }],
    });
    tx.payment.findUnique.mockResolvedValue({
      id: 'pay-1', status: 'SUCCEEDED', purpose: 'STATIONERY', amount: new Prisma.Decimal('10.00'), studentId: 'student-1',
    });
    tx.stationeryItem.findUnique.mockResolvedValue({ id: 'item-1', sku: 'PEN', isActive: true, stockQty: 2 });

    await expect(service.markReadyForCollection('order-1', 'actor-1', ['OFFICE' as any])).rejects.toThrow(ConflictException);
  });

  it('does not process a second fulfillment after the order leaves PAID state', async () => {
    tx.stationeryOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNumber: 'ST-1', status: 'READY_FOR_COLLECTION', paymentId: 'pay-1', lines: [],
    });

    await expect(service.markReadyForCollection('order-1', 'actor-1', ['OFFICE' as any])).rejects.toThrow(BadRequestException);
  });

  it('rejects a stock race when the conditional decrement affects no row', async () => {
    tx.stationeryOrder.findUnique.mockResolvedValue({
      id: 'order-1', orderNumber: 'ST-1', status: 'PAID', paymentId: 'pay-1', studentId: 'student-1',
      totalAmount: new Prisma.Decimal('2.00'),
      lines: [{ itemId: 'item-1', quantity: 1, unitPrice: new Prisma.Decimal('2.00'), lineTotal: new Prisma.Decimal('2.00') }],
    });
    tx.payment.findUnique.mockResolvedValue({
      id: 'pay-1', status: 'SUCCEEDED', purpose: 'STATIONERY', amount: new Prisma.Decimal('2.00'), studentId: 'student-1',
    });
    tx.stationeryItem.findUnique.mockResolvedValue({ id: 'item-1', sku: 'PEN', isActive: true, stockQty: 1 });
    tx.stationeryItem.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.markReadyForCollection('order-1', 'actor-1', ['OFFICE' as any])).rejects.toThrow(ConflictException);
  });  it('attaches only a matching succeeded stationery payment to a draft order', async () => {
    tx.stationeryOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ST-1',
      studentId: 'student-1',
      guardianId: 'guardian-1',
      status: 'DRAFT',
      totalAmount: new Prisma.Decimal('25.00'),
      paymentId: null,
    });
    tx.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      studentId: 'student-1',
      guardianId: 'guardian-1',
      amount: new Prisma.Decimal('25.00'),
      currency: 'GHS',
      purpose: 'STATIONERY',
      status: 'SUCCEEDED',
      completedAt: new Date(),
      provider: 'MOOLRE',
      providerReference: 'ref-1',
    });
    tx.stationeryOrder.findFirst.mockResolvedValue(null);
    tx.stationeryOrder.update.mockResolvedValue({ id: 'order-1', status: 'PAID', paymentId: 'pay-1' });

    const result = await service.attachSuccessfulPayment('order-1', 'pay-1', 'actor-1', ['OFFICE' as any]);
    expect(result).toMatchObject({ status: 'PAID', paymentId: 'pay-1' });
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.stationeryOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { paymentId: 'pay-1', status: 'PAID' },
    });
  });

  it('rejects attaching a fee payment to a stationery order', async () => {
    tx.stationeryOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'ST-1',
      studentId: 'student-1',
      guardianId: 'guardian-1',
      status: 'DRAFT',
      totalAmount: new Prisma.Decimal('25.00'),
      paymentId: null,
    });
    tx.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      studentId: 'student-1',
      guardianId: 'guardian-1',
      amount: new Prisma.Decimal('25.00'),
      currency: 'GHS',
      purpose: 'FEE',
      status: 'SUCCEEDED',
    });
    await expect(service.attachSuccessfulPayment('order-1', 'pay-1', 'actor-1', ['OFFICE' as any]))
      .rejects.toThrow(ConflictException);
  });


});
