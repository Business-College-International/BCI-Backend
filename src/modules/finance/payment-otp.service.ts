import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { MoolreAdapter } from '../payment-providers/moolre.adapter';
import { SubmitPaymentOtpDto } from './dto/submit-payment-otp.dto';

const PRIVILEGED_FINANCE_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
  RoleName.OFFICE,
]);

@Injectable()
export class PaymentOtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moolre: MoolreAdapter,
  ) {}

  async submit(
    studentId: string,
    paymentId: string,
    dto: SubmitPaymentOtpDto,
    actorUserId: string,
    roles: RoleName[],
    idempotencyKey: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new ConflictException('An Idempotency-Key header is required for OTP submission.');
    }

    const network = dto.network?.trim().toUpperCase() ?? null;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({
        studentId,
        paymentId,
        otpCode: dto.otpCode,
        sessionId: dto.sessionId ?? null,
        network,
      }))
      .digest('hex');

    const reservation = await this.prisma.$transaction(async (tx) => {
      const existingKey = await tx.idempotencyKey.findUnique({
        where: { userId_key_operation: { userId: actorUserId, key: idempotencyKey.trim(), operation: 'payments.otp' } },
      });
      if (existingKey) {
        if (existingKey.requestHash !== requestHash) {
          throw new ConflictException('The OTP idempotency key was already used with a different payment request.');
        }
        if (!existingKey.responseJson) {
          throw new ConflictException('An identical OTP submission is already in progress.');
        }
        return { existing: existingKey.responseJson as Record<string, unknown> };
      }

      await this.assertFinanceAccess(tx, studentId, actorUserId, roles);

      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          studentId: true,
          guardianId: true,
          amount: true,
          currency: true,
          status: true,
          provider: true,
          providerReference: true,
          clientReference: true,
        },
      });
      if (!payment || payment.studentId !== studentId) throw new NotFoundException('Payment not found.');
      if (payment.provider !== this.moolre.provider) throw new BadRequestException('OTP continuation is only available for Moolre payments.');
      if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.PROCESSING) {
        throw new ConflictException('This payment is no longer awaiting OTP submission.');
      }
      if (!payment.clientReference) throw new ConflictException('Payment is missing its provider client reference.');

      const attempt = await tx.paymentProviderAttempt.findFirst({
        where: { paymentId: payment.id, provider: this.moolre.provider },
        orderBy: { requestedAt: 'desc' },
      });
      if (!attempt) throw new NotFoundException('Payment provider attempt not found.');

      let payer: string | null = null;
      if (payment.guardianId) {
        const guardianPerson = await tx.person.findUnique({ where: { id: payment.guardianId }, select: { phone: true } });
        payer = guardianPerson?.phone ?? null;
      }
      if (!payer) {
        const primary = await tx.guardianStudent.findFirst({
          where: { studentId, isPrimaryContact: true },
          include: { guardian: { select: { person: { select: { phone: true } } } } },
        });
        payer = primary?.guardian.person.phone ?? null;
      }
      if (!payer) throw new ConflictException('Payment payer information is unavailable for OTP continuation.');

      const responsePayload = asRecord(attempt.responsePayload);
      if (responsePayload.requiresOtp !== true) {
        throw new ConflictException('This payment is not awaiting OTP submission.');
      }
      const storedSessionId = typeof responsePayload.sessionId === 'string' ? responsePayload.sessionId : null;
      const storedNetwork = typeof responsePayload.network === 'string' ? responsePayload.network : null;
      const selectedNetwork = network ?? storedNetwork ?? 'MTN';

      await tx.idempotencyKey.create({
        data: {
          userId: actorUserId,
          key: idempotencyKey.trim(),
          operation: 'payments.otp',
          requestHash,
        },
      });

      return {
        payment,
        attemptId: attempt.id,
        payer,
        network: selectedNetwork,
        sessionId: dto.sessionId ?? storedSessionId,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 10000,
    });

    if ('existing' in reservation) return reservation.existing;

    let providerResult: Awaited<ReturnType<MoolreAdapter['submitPaymentOtp']>>;
    try {
      providerResult = await this.moolre.submitPaymentOtp({
        clientReference: reservation.payment.clientReference!,
        amount: reservation.payment.amount.toFixed(2),
        currency: reservation.payment.currency,
        payer: reservation.payer,
        network: reservation.network,
        otpCode: dto.otpCode,
        sessionId: reservation.sessionId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Moolre OTP submission failed.';
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentProviderAttempt.update({
          where: { id: reservation.attemptId },
          data: {
            status: PaymentStatus.FAILED,
            resolvedAt: new Date(),
            failureCode: 'OTP_SUBMISSION_FAILED',
            failureMessage: message,
          },
        });
        await tx.idempotencyKey.update({
          where: { userId_key_operation: { userId: actorUserId, key: idempotencyKey.trim(), operation: 'payments.otp' } },
          data: {
            responseJson: { paymentId, status: PaymentStatus.PROCESSING, retryable: true },
            statusCode: 400,
            completedAt: new Date(),
          },
        });
      });
      throw error;
    }

    const response = {
      paymentId: reservation.payment.id,
      clientReference: reservation.payment.clientReference,
      status: PaymentStatus.PROCESSING,
      provider: this.moolre.provider,
      providerReference: providerResult.providerReference,
      requiresOtp: providerResult.requiresOtp,
      mock: providerResult.mock,
      sessionId: providerResult.sessionId ?? reservation.sessionId ?? null,
      network: reservation.network,
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: reservation.payment.id },
          data: {
            status: PaymentStatus.PROCESSING,
            provider: this.moolre.provider,
            providerReference: providerResult.providerReference ?? reservation.payment.providerReference,
          },
        });
        await tx.paymentProviderAttempt.update({
          where: { id: reservation.attemptId },
          data: {
            status: PaymentStatus.PROCESSING,
            providerReference: providerResult.providerReference,
            responsePayload: response,
            resolvedAt: providerResult.requiresOtp ? null : new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'UPDATE',
            entityType: 'Payment',
            entityId: reservation.payment.id,
            afterJson: {
              status: PaymentStatus.PROCESSING,
              otpContinuation: true,
              requiresOtp: providerResult.requiresOtp,
              providerReference: providerResult.providerReference,
            },
          },
        });
        await tx.idempotencyKey.update({
          where: { userId_key_operation: { userId: actorUserId, key: idempotencyKey.trim(), operation: 'payments.otp' } },
          data: {
            responseJson: response,
            statusCode: 202,
            completedAt: new Date(),
          },
        });
      });
      return response;
    } catch {
      throw new ConflictException('OTP was accepted by the provider, but local state could not be persisted. Reconcile the payment before retrying.');
    }
  }

  private async assertFinanceAccess(tx: Prisma.TransactionClient, studentId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_FINANCE_ROLES.has(role))) return;
    const guardian = await tx.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!guardian) throw new ForbiddenException('You do not have permission to submit OTP for this student payment.');
    const link = await tx.guardianStudent.findUnique({
      where: { guardianId_studentId: { guardianId: guardian.personId, studentId } },
      select: { canPayFees: true },
    });
    if (!link?.canPayFees) throw new ForbiddenException('This guardian is not permitted to pay fees for this ward.');
  }
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
