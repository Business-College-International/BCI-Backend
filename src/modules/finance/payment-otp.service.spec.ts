import { PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentOtpService } from './payment-otp.service';

function makePrisma() {
  return {
    idempotencyKey: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    guardian: { findUnique: jest.fn() },
    guardianStudent: { findUnique: jest.fn(), findFirst: jest.fn() },
    payment: { findUnique: jest.fn(), update: jest.fn() },
    person: { findUnique: jest.fn() },
    paymentProviderAttempt: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  } as any;
}

function makeAdapter() {
  return {
    provider: 'MOOLRE',
    submitPaymentOtp: jest.fn(),
  } as any;
}

describe('PaymentOtpService', () => {
  it('requires an idempotency key', async () => {
    const prisma = makePrisma();
    const service = new PaymentOtpService(prisma, makeAdapter());

    await expect(service.submit('student-1', 'payment-1', { otpCode: '123456' }, 'guardian-user', [RoleName.GUARDIAN], ''))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('submits OTP and reuses the persisted payment network when the DTO omits it', async () => {
    const prisma = makePrisma();
    const adapter = makeAdapter();
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canPayFees: true });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1',
      studentId: 'student-1',
      guardianId: 'guardian-1',
      amount: new Prisma.Decimal('50.00'),
      currency: 'GHS',
      status: PaymentStatus.PROCESSING,
      provider: 'MOOLRE',
      providerReference: null,
      clientReference: 'bci-ref-1',
    });
    prisma.paymentProviderAttempt.findFirst.mockResolvedValue({
      id: 'attempt-1',
      responsePayload: { requiresOtp: true, sessionId: 'session-1', network: 'TELECEL' },
    });
    prisma.person.findUnique.mockResolvedValue({ phone: '0244000000' });
    prisma.paymentProviderAttempt.update.mockResolvedValue({});
    prisma.payment.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.update.mockResolvedValue({});
    adapter.submitPaymentOtp.mockResolvedValue({
      providerReference: 'moolre-ref-otp-1',
      requiresOtp: false,
      mock: true,
      sessionId: 'session-1',
    });

    const service = new PaymentOtpService(prisma, adapter);
    const result = await service.submit(
      'student-1',
      'payment-1',
      { otpCode: '123456', sessionId: 'session-1' },
      'guardian-user',
      [RoleName.GUARDIAN],
      'otp-idem-1',
    );

    expect(adapter.submitPaymentOtp).toHaveBeenCalledWith(expect.objectContaining({
      clientReference: 'bci-ref-1',
      amount: '50.00',
      payer: '0244000000',
      network: 'TELECEL',
      otpCode: '123456',
      sessionId: 'session-1',
    }));
    expect(result).toMatchObject({
      paymentId: 'payment-1',
      providerReference: 'moolre-ref-otp-1',
      status: PaymentStatus.PROCESSING,
      network: 'TELECEL',
    });
    expect(prisma.idempotencyKey.create).toHaveBeenCalled();
    expect(prisma.idempotencyKey.update).toHaveBeenCalled();
  });

  it('leaves the payment processing when the provider rejects an OTP so another OTP can be tried', async () => {
    const prisma = makePrisma();
    const adapter = makeAdapter();
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canPayFees: true });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1', studentId: 'student-1', guardianId: 'guardian-1',
      amount: new Prisma.Decimal('50.00'), currency: 'GHS', status: PaymentStatus.PROCESSING,
      provider: 'MOOLRE', providerReference: null, clientReference: 'bci-ref-1',
    });
    prisma.paymentProviderAttempt.findFirst.mockResolvedValue({
      id: 'attempt-1',
      responsePayload: { requiresOtp: true, sessionId: 'session-1', network: 'MTN' },
    });
    prisma.person.findUnique.mockResolvedValue({ phone: '0244000000' });
    prisma.paymentProviderAttempt.update.mockResolvedValue({});
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.update.mockResolvedValue({});
    adapter.submitPaymentOtp.mockRejectedValue(new BadRequestException('Incorrect OTP.'));

    const service = new PaymentOtpService(prisma, adapter);
    await expect(service.submit('student-1', 'payment-1', { otpCode: '000000' }, 'guardian-user', [RoleName.GUARDIAN], 'otp-idem-2'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.paymentProviderAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({ status: PaymentStatus.FAILED, failureCode: 'OTP_SUBMISSION_FAILED' }),
    }));
  });

  it('keeps an ambiguous OTP submission in processing and requires reconciliation before another OTP', async () => {
    const prisma = makePrisma();
    const adapter = makeAdapter();
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canPayFees: true });
    prisma.payment.findUnique.mockResolvedValue({
      id: 'payment-1', studentId: 'student-1', guardianId: 'guardian-1',
      amount: new Prisma.Decimal('50.00'), currency: 'GHS', status: PaymentStatus.PROCESSING,
      provider: 'MOOLRE', providerReference: null, clientReference: 'bci-ref-1',
    });
    prisma.paymentProviderAttempt.findFirst
      .mockResolvedValueOnce({
        id: 'attempt-1',
        responsePayload: { requiresOtp: true, sessionId: 'session-1', network: 'MTN' },
      })
      .mockResolvedValueOnce({
        id: 'attempt-1',
        responsePayload: { requiresOtp: true, sessionId: 'session-1', network: 'MTN', otpOutcomeUnknown: true },
      });
    prisma.person.findUnique.mockResolvedValue({ phone: '0244000000' });
    prisma.paymentProviderAttempt.updateMany.mockResolvedValue({ count: 1 });
    prisma.idempotencyKey.create.mockResolvedValue({});
    adapter.submitPaymentOtp.mockRejectedValue(new Error('provider timeout after request'));

    const service = new PaymentOtpService(prisma, adapter);
    await expect(service.submit('student-1', 'payment-1', { otpCode: '123456' }, 'guardian-user', [RoleName.GUARDIAN], 'otp-idem-3'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.paymentProviderAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },
      data: expect.objectContaining({
        status: PaymentStatus.PROCESSING,
        failureCode: 'OTP_SUBMISSION_UNKNOWN',
        responsePayload: expect.objectContaining({ otpOutcomeUnknown: true }),
      }),
    });
    expect(prisma.idempotencyKey.update).not.toHaveBeenCalled();

    await expect(service.submit('student-1', 'payment-1', { otpCode: '654321' }, 'guardian-user', [RoleName.GUARDIAN], 'otp-idem-4'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(adapter.submitPaymentOtp).toHaveBeenCalledTimes(1);
  });
});
