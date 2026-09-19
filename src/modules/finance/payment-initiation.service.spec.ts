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
  });

  it('reserves invoice balance before provider initiation and forwards the selected network', async () => {
    const { service, moolre, reservationTx } = makeService();

    const result = await service.initiate('student-1', dto, 'guardian-user', [RoleName.GUARDIAN], 'idem-1');

    expect(reservationTx.$executeRaw).toHaveBeenCalled();
    expect(reservationTx.paymentIntent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ studentId: 'student-1', invoiceId: 'invoice-1', paymentId: 'payment-1', status: 'PENDING' }),
    }));
    expect(reservationTx.paymentAllocation.create).not.toHaveBeenCalled();
    expect(reservationTx.paymentIntent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ invoiceId: 'invoice-1', paymentId: 'payment-1' }) }));
    expect(reservationTx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: new Prisma.Decimal('50.00'), idempotencyKey: 'idem-1' }),
    }));
    expect(moolre.initiatePayment).toHaveBeenCalledWith(expect.objectContaining({
      customer: expect.objectContaining({ network: 'TELECEL' }),
    }));
    expect(result).toMatchObject({ paymentId: 'payment-1', status: PaymentStatus.PROCESSING, providerReference: 'moolre-ref-1' });
  });

  it('records an explicit provider rejection as failed instead of processing', async () => {
    const { service, moolre, prisma, completionTx } = makeService();
    moolre.initiatePayment.mockRejectedValueOnce(new BadRequestException('Invalid phone number.'));

    await expect(service.initiate('student-1', dto, 'guardian-user', [RoleName.GUARDIAN], 'idem-rejected'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(completionTx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: PaymentStatus.PENDING },
      data: expect.objectContaining({
        status: PaymentStatus.FAILED,
        failureCode: 'PROVIDER_INITIATION_REJECTED',
        failureMessage: 'Invalid phone number.',
      }),
    });
    expect(completionTx.paymentProviderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: PaymentStatus.PENDING },
      data: expect.objectContaining({
        status: PaymentStatus.FAILED,
        failureCode: 'PROVIDER_INITIATION_REJECTED',
        failureMessage: 'Invalid phone number.',
      }),
    });
    expect(completionTx.idempotencyKey.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        responseJson: expect.objectContaining({
          status: PaymentStatus.FAILED,
          retryable: true,
          failureCode: 'PROVIDER_INITIATION_REJECTED',
        }),
      }),
    }));
  });

  it('keeps a payment processing when provider initiation outcome is unknown', async () => {
    const { service, moolre, prisma, completionTx } = makeService();
    moolre.initiatePayment.mockRejectedValueOnce(new Error('provider timeout after request'));

    await expect(service.initiate('student-1', dto, 'guardian-user', [RoleName.GUARDIAN], 'idem-2'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(completionTx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.PROCESSING,
        provider: 'MOOLRE',
        providerReference: null,
        failureCode: 'PROVIDER_INITIATION_UNKNOWN',
        failureMessage: 'Provider initiation outcome is unknown; awaiting webhook reconciliation.',
        completedAt: null,
      },
    });
    expect(completionTx.paymentProviderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.PROCESSING,
        providerReference: null,
        failureCode: 'PROVIDER_INITIATION_UNKNOWN',
        failureMessage: 'Provider initiation outcome is unknown; awaiting webhook reconciliation.',
        resolvedAt: null,
      },
    });
  });

  it('does not mark the payment failed when the provider accepted but local state persistence failed', async () => {
    const { service, prisma, moolre, reservationTx } = makeService();
    const persistenceError = new Error('database unavailable');
    prisma.$transaction.mockReset()