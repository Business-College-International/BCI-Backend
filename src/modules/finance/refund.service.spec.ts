import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, RoleName, PaymentStatus } from '@prisma/client';
import { RefundService } from './refund.service';

function mockPrisma() {
  return { payment: { findUnique: jest.fn() }, refund: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() }, auditLog: { create: jest.fn() }, $transaction: jest.fn() } as any;
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

  it('prevents refund self-approval', async () => {
    const prisma = mockPrisma();
    prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(prisma));
    prisma.refund.findUnique.mockResolvedValue({ id: 'refund-1', status: PaymentStatus.PENDING, requestedBy: 'user-1', approvedBy: null });
    const service = new RefundService(prisma);
    await expect(service.approveRefund('refund-1', 'user-1', [RoleName.ACCOUNTANT]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
