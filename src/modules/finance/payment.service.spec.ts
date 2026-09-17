import { ConflictException } from '@nestjs/common';
import { PaymentStatus, RoleName } from '@prisma/client';
import { PaymentService } from './payment.service';

function makeTx() {
  return {
    $executeRaw: jest.fn(),
    idempotencyKey: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    studentInvoice: { findMany: jest.fn() },
    payment: {
      create: jest.fn().mockResolvedValue({ id: 'payment-1', allocations: [{ invoiceId: 'invoice-1', amount: '100.00' }] }),
      update: jest.fn(),
      allocation: undefined,
    },
    paymentProviderAttempt: { create: jest.fn(), updateMany: jest.fn() },
    paymentAllocation: { deleteMany: jest.fn() },
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  return {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    guardian: { findUnique: jest.fn().mockResolvedValue({ personId: 'guardian-1' }) },
    guardianStudent: { findUnique: jest.fn().mockResolvedValue({ canPayFees: true }) },
    student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', firstName: 'Ama', lastName: 'Doe' }) },
  };
}

describe('PaymentService', () => {
  const dto = {
    invoiceIds: ['invoice-1'],
    amount: '100.00',
    idempotencyKey: 'payment-key-1',
    callbackUrl: 'https://bci.example/payments/moolre/callback',
    customerPhone: '0244000000',
    customerName: 'Ama Doe',
    network: 'MTN',
  };

  it('rejects re-use of an idempotency key with a different request hash', async () => {
    const tx = makeTx();
    tx.idempotencyKey.findUnique.mockResolvedValue({ requestHash: 'different-hash', responseJson: null });
    const prisma = makePrisma(tx);
    const provider = { provider: 'MOOLRE', initiatePayment: jest.fn() };
    const service = new PaymentService(prisma as never, provider as never);

    await expect(service.initiate('student-1', dto, 'guardian-user-1', [RoleName.GUARDIAN]))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('creates a durable pending payment allocation before calling the provider', async () => {
    const tx = makeTx();
    tx.studentInvoice.findMany.mockResolvedValue([{
      id: 'invoice-1',
      lines: [{ amountDue: '100.00' }],
      allocations: [],
      status: 'OPEN',
    }]);
    tx.idempotencyKey.findUnique.mockResolvedValue(null);
    const prisma = makePrisma(tx);
    const provider = {
      provider: 'MOOLRE',
      initiatePayment: jest.fn().mockResolvedValue({ providerReference: 'moolre-1', requiresOtp: false, mock: true }),
    };
    const service = new PaymentService(prisma as never, provider as never);

    const result = await service.initiate('student-1', dto, 'guardian-user-1', [RoleName.GUARDIAN]);

    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: PaymentStatus.PENDING }) }));
    expect(tx.paymentProviderAttempt.create).toHaveBeenCalled();
    expect(provider.initiatePayment).toHaveBeenCalled();
    expect(result.status).toBe(PaymentStatus.PROCESSING);
    expect(result.providerReference).toBe('moolre-1');
  });
});
