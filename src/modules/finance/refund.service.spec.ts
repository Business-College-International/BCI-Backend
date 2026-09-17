import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, RoleName, PaymentStatus } from '@prisma/client';
import { RefundService } from './refund.service';

function mockPrisma() {
  return {
    payment: { findUnique: jest.fn() },
    refund: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  } as any;
}

describe('RefundService', () => {
  it('rejects refund amounts above the remaining refundable payment amount', async () => {
    const prisma = mockPrisma();
    const tx = prisma;
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: new Prisma.Decimal('100.00'), refunds: [{ amount: new Prisma.Decimal('60.00'), status: PaymentStatus.SUCCEEDED }],
    });
    const service = new RefundService(prisma);
    await expect(service.requestRefund({ paymentId: 'payment-1', amount: '41.00', reason: 'Duplicate payment' }, 'user-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('runs refund reservation under serializable isolation', async () => {
    const prisma = mockPrisma();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: new Prisma.Decimal('100.00'), refunds: [],
    });
    prisma.refund.create.mockResolvedValue({ id: 'refund-1', paymentId: 'payment-1', amount: new Prisma.Decimal('40.00'), reason: 'Duplicate payment', requestedBy: 'user-1', status: PaymentStatus.PENDING });
    const service = new RefundService(prisma);

    await service.requestRefund({ paymentId: 'payment-1', amount: '40.00', reason: 'Duplicate payment' }, 'user-1', [RoleName.ACCOUNTANT]);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }));
  });

  it('translates a refund serialization conflict into a retryable conflict response', async () => {
    const prisma = mockPrisma();
    prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    const service = new RefundService(prisma);

    await expect(service.requestRefund({ paymentId: 'payment-1', amount: '40.00', reason: 'Duplicate payment' }, 'user-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents refund self-approval', async () => {
    const prisma = mockPrisma();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique.mockResolvedValue({ id: 'refund-1', status: PaymentStatus.PENDING, requestedBy: 'user-1', approvedBy: null });
    const service = new RefundService(prisma);
    await expect(service.approveRefund('refund-1', 'user-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an approval race when another approver wins the conditional transition', async () => {
    const prisma = mockPrisma();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique.mockResolvedValue({ id: 'refund-1', status: PaymentStatus.PENDING, requestedBy: 'requester', approvedBy: null });
    prisma.refund.updateMany.mockResolvedValue({ count: 0 });
    const service = new RefundService(prisma);

    await expect(service.approveRefund('refund-1', 'approver-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('records a successful conditional approval and returns the persisted refund', async () => {
    const prisma = mockPrisma();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique
      .mockResolvedValueOnce({ id: 'refund-1', status: PaymentStatus.PENDING, requestedBy: 'requester', approvedBy: null })
      .mockResolvedValueOnce({ id: 'refund-1', status: PaymentStatus.PENDING, requestedBy: 'requester', approvedBy: 'approver-1' });
    prisma.refund.updateMany.mockResolvedValue({ count: 1 });
    const service = new RefundService(prisma);

    const result = await service.approveRefund('refund-1', 'approver-1', [RoleName.ACCOUNTANT]);

    expect(result.approvedBy).toBe('approver-1');
    expect(prisma.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund-1', status: PaymentStatus.PENDING, approvedBy: null },
    }));
  });
});
