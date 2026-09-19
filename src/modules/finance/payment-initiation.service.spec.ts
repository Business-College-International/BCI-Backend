import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { PaymentInitiationService } from './payment-initiation.service';

const dto = {
  invoiceIds: ['invoice-1'],
  amount: '50.00',
  network: 'Telecel',
  callbackUrl: 'https://bci.example/payment/callback',
};

function makeService() {
  const moolre = {
    provider: 'MOOLRE',
    initiatePayment: jest.fn().mockResolvedValue({
      providerReference: 'moolre-ref-1',
      requiresOtp: false,
      mock: true,
    }),
  };

  const reservationTx = {
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    guardian: { findUnique: jest.fn().mockResolvedValue({ personId: 'guardian-1' }) },
    guardianStudent: { findUnique: jest.fn().mockResolvedValue({ canPayFees: true }) },
    person: { findUnique: jest.fn().mockResolvedValue({ id: 'guardian-1', firstName: 'Grace', lastName: 'Guardian', phone: '0244000000' }) },
    $executeRaw: jest.fn().mockResolvedValue([]),
    studentInvoice: {
      findMany: jest.fn().mockResolvedValue([{
        id: 'invoice-1',
        invoiceNumber: 'BCI-INV-1',
        status: 'OPEN',
        lines: [{ amountDue: new Prisma.Decimal('100.00') }],
        allocations: [],
      }]),
    },
    payment: {
      create: jest.fn().mockResolvedValue({
        id: 'payment-1',
        amount: new Prisma.Decimal('50.00'),
        currency: 'GHS',
        status: PaymentStatus.PENDING,
        clientReference: 'bci-client-ref',
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    paymentAllocation: { create: jest.fn().mockResolvedValue({}) },
    paymentProviderAttempt: {
      create: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    paymentIntent: { create: jest.fn().mockResolvedValue({ id: 'intent-1', invoiceId: 'invoice-1', amount: new Prisma.Decimal('50.00'), expiresAt: new Date('2026-09-19T06:15:00.000Z') }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const completionTx = {
    payment: {
      update: jest.fn().mockResolvedValue({
        id: 'payment-1',
        amount: new Prisma.Decimal('50.00'),
        currency: 'GHS',
        status: PaymentStatus.PROCESSING,
        clientReference: 'bci-client-ref',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    paymentProviderAttempt: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    paymentIntent: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    idempotencyKey: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    $transaction: jest.fn()
      .mockImplementationOnce(async (callback: (tx: any) => unknown) => callback(reservationTx))
      .mockImplementationOnce(async (callback: (tx: any) => unknown) => callback(completionTx)),
  };

  return { service: new PaymentInitiationService(prisma as any, moolre as any), prisma, moolre, reservationTx, completionTx };
}

describe('PaymentInitiationService', () => {
  it('requires an idempotency key', async () => {
    const { service } = makeService();
    await expect(service.initiate('student-1', dto, 'guardian-user', [RoleName.GUARDIAN], ''))
      .rejects.toBeInstanceOf(ConflictException);