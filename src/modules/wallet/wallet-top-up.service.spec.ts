import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentPurpose, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { WalletTopUpService } from './wallet-top-up.service';

function makePrisma() {
  const tx = {
    idempotencyKey: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    guardian: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    guardianStudent: { findUnique: jest.fn() },
    person: { findUnique: jest.fn() },
    payment: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    paymentProviderAttempt: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx };
}

function makeAdapter() {
  return {
    provider: 'MOOLRE',
    initiatePayment: jest.fn(),
  } as any;
}

describe('WalletTopUpService', () => {
  it('requires an idempotency key', async () => {
    const { prisma } = makePrisma();
    const service = new WalletTopUpService(prisma as any, makeAdapter());
    await expect(service.initiate('student-1', { amount: '50.00' }, 'guardian-user', [RoleName.GUARDIAN], ''))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('requires the wallet-management capability on the guardian relationship', async () => {
    const { prisma } = makePrisma();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canManageWallet: false });

    const service = new WalletTopUpService(prisma as any, makeAdapter());
    await expect(service.initiate(
      'student-1',
      { amount: '50.00' },
      'guardian-user',
      [RoleName.GUARDIAN],
      'wallet-topup-1',
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reserves a wallet top-up before provider initiation', async () => {
    const { prisma } = makePrisma();
    const adapter = makeAdapter();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canManageWallet: true });
    prisma.person.findUnique.mockResolvedValue({ id: 'guardian-1', firstName: 'Ama', lastName: 'Parent', phone: '0244000000' });
    prisma.payment.create.mockResolvedValue({
      id: 'payment-1',
      studentId: 'student-1',
      guardianId: 'guardian-1',
      amount: new Prisma.Decimal('50.00'),
      currency: 'GHS',
      status: PaymentStatus.PENDING,
      purpose: PaymentPurpose.WALLET_TOP_UP,
      clientReference: 'bci-wallet-ref-1',
    });
    prisma.paymentProviderAttempt.create.mockResolvedValue({ id: 'attempt-1' });
    adapter.initiatePayment.mockResolvedValue({
      providerReference: 'moolre-ref-1',
      requiresOtp: false,
      mock: true,
      sessionId: null,
    });

    const service = new WalletTopUpService(prisma as any, adapter);
    const result = await service.initiate(
      'student-1',
      { amount: '50.00', network: 'Telecel' },
      'guardian-user',
      [RoleName.GUARDIAN],
      'wallet-topup-2',
    );

    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        amount: new Prisma.Decimal('50.00'),
        purpose: PaymentPurpose.WALLET_TOP_UP,
        idempotencyKey: 'wallet-topup-2',
      }),
    }));
    expect(adapter.initiatePayment).toHaveBeenCalledWith(expect.objectContaining({
      purpose: PaymentPurpose.WALLET_TOP_UP,
      customer: expect.objectContaining({ phone: '0244000000', network: 'TELECEL' }),
    }));
    expect(result).toMatchObject({
      paymentId: 'payment-1',
      purpose: PaymentPurpose.WALLET_TOP_UP,
      status: PaymentStatus.PROCESSING,
    });
  });

  it('preserves processing state when provider initiation outcome is unknown', async () => {
    const { prisma } = makePrisma();
    const adapter = makeAdapter();
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canManageWallet: true });
    prisma.person.findUnique.mockResolvedValue({ id: 'guardian-1', firstName: 'Ama', lastName: 'Parent', phone: '0244000000' });
    prisma.payment.create.mockResolvedValue({
      id: 'payment-1',
      studentId: 'student-1',
      guardianId: 'guardian-1',
      amount: new Prisma.Decimal('50.00'),
      currency: 'GHS',
      status: PaymentStatus.PENDING,
      purpose: PaymentPurpose.WALLET_TOP_UP,
      clientReference: 'bci-wallet-ref-1',
    });
    prisma.paymentProviderAttempt.create.mockResolvedValue({ id: 'attempt-1' });
    adapter.initiatePayment.mockRejectedValue(new Error('provider timeout'));

    const service = new WalletTopUpService(prisma as any, adapter);
    await expect(service.initiate(
      'student-1',
      { amount: '50.00' },
      'guardian-user',
      [RoleName.GUARDIAN],
      'wallet-topup-3',
    )).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'payment-1', status: PaymentStatus.PENDING },
      data: expect.objectContaining({
        status: PaymentStatus.PROCESSING,
        failureCode: 'PROVIDER_INITIATION_UNKNOWN',
      }),
    }));
  });
});
