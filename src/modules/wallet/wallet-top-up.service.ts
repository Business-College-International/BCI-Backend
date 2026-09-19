import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PaymentPurpose, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { MoolreAdapter } from '../payment-providers/moolre.adapter';
import { WalletTopUpDto } from './dto/wallet-top-up.dto';

@Injectable()
export class WalletTopUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moolre: MoolreAdapter,
  ) {}

  async initiate(
    studentId: string,
    dto: WalletTopUpDto,
    actorUserId: string,
    roles: RoleName[],
    idempotencyKey: string,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new ConflictException('An Idempotency-Key header is required for wallet top-up initiation.');
    }
    if (!roles.includes(RoleName.GUARDIAN)) {
      throw new ForbiddenException('Only a guardian can initiate a wallet top-up for a ward.');
    }

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new ConflictException('Wallet top-up amount must be greater than zero.');

    const normalizedKey = idempotencyKey.trim();
    const network = dto.network?.trim().toUpperCase() || null;
    const requestHash = createHash('sha256')
      .update(JSON.stringify({
        studentId,
        amount: dto.amount,
        network,
        callbackUrl: dto.callbackUrl ?? null,
      }))
      .digest('hex');

    let reservation;
    try {
      reservation = await this.prisma.$transaction(async (tx) => {
        const existingKey = await tx.idempotencyKey.findUnique({
          where: {
            userId_key_operation: {
              userId: actorUserId,
              key: normalizedKey,
              operation: 'wallet.topup',
            },
          },
        });
        if (existingKey) {
          if (existingKey.requestHash !== requestHash) {
            throw new ConflictException('The wallet top-up Idempotency-Key was already used with different parameters.');
          }
          if (existingKey.responseJson) return { existing: existingKey.responseJson as Record<string, unknown> };
          throw new ConflictException('An identical wallet top-up is already in progress.');
        }

        const guardian = await tx.guardian.findUnique({
          where: { userId: actorUserId },
          select: { personId: true },
        });
        if (!guardian) {
          throw new ForbiddenException('Guardian account information is required before a wallet top-up can be initiated.');
        }

        const student = await tx.student.findUnique({
          where: { id: studentId },
          select: { id: true },
        });
        if (!student) throw new NotFoundException('Student not found.');

        const link = await tx.guardianStudent.findUnique({
          where: {
            guardianId_studentId: {
              guardianId: guardian.personId,
              studentId,
            },
          },
          select: { canManageWallet: true },
        });
        if (!link?.canManageWallet) {
          throw new ForbiddenException('This guardian is not permitted to manage this ward wallet.');
        }

        const person = await tx.person.findUnique({
          where: { id: guardian.personId },
          select: { id: true, firstName: true, lastName: true, phone: true },
        });
        if (!person?.phone) {
          throw new ConflictException('A guardian phone number is required before initiating a wallet top-up.');
        }

        const clientReference = `bci-wallet-${randomBytes(12).toString('hex')}`;
        const payment = await tx.payment.create({
          data: {
            studentId,
            guardianId: guardian.personId,
            amount,
            purpose: PaymentPurpose.WALLET_TOP_UP,
            status: PaymentStatus.PENDING,
            clientReference,
            idempotencyKey: normalizedKey,
          },
        });

        const attempt = await tx.paymentProviderAttempt.create({
          data: {
            paymentId: payment.id,
            provider: this.moolre.provider,
            status: PaymentStatus.PENDING,
          },
        });

        await tx.idempotencyKey.create({
          data: {
            userId: actorUserId,
            key: normalizedKey,
            operation: 'wallet.topup',
            requestHash,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'Payment',
            entityId: payment.id,
            afterJson: {
              amount: payment.amount.toFixed(2),
              currency: payment.currency,
              purpose: payment.purpose,
              studentId,
              clientReference: payment.clientReference,
              reservation: true,
            },
          },
        });

        return {
          payment,
          attemptId: attempt.id,
          customer: {
            name: `${person.firstName} ${person.lastName}`.trim(),
            phone: person.phone,
            ...(network ? { network } : {}),
          },
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const existing = await this.prisma.idempotencyKey.findUnique({
          where: {
            userId_key_operation: {
              userId: actorUserId,
              key: normalizedKey,
              operation: 'wallet.topup',
            },
          },
        });
        if (existing?.requestHash !== requestHash) {
          throw new ConflictException('The wallet top-up Idempotency-Key was already used with different parameters.');
        }
        if (!existing?.responseJson) {
          throw new ConflictException('An identical wallet top-up is already in progress.');
        }
        return existing.responseJson as Record<string, unknown>;
      }
      throw error;
    }

    if ('existing' in reservation) return reservation.existing;

    let providerResult: Awaited<ReturnType<MoolreAdapter['initiatePayment']>>;
    try {
      providerResult = await this.moolre.initiatePayment({
        clientReference: reservation.payment.clientReference!,
        amount: reservation.payment.amount.toFixed(2),
        currency: reservation.payment.currency,
        purpose: PaymentPurpose.WALLET_TOP_UP,
        callbackUrl: dto.callbackUrl ?? '',
        customer: reservation.customer,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        const failureMessage = error.message;
        await this.prisma.$transaction(async (tx) => {
          await tx.payment.updateMany({
            where: { id: reservation.payment.id, status: PaymentStatus.PENDING },
            data: {
              status: PaymentStatus.FAILED,
              provider: this.moolre.provider,
              providerReference: null,
              failureCode: 'PROVIDER_INITIATION_REJECTED',
              failureMessage,
              completedAt: new Date(),
            },
          });
          await tx.paymentProviderAttempt.updateMany({
            where: { id: reservation.attemptId, status: PaymentStatus.PENDING },
            data: {
              status: PaymentStatus.FAILED,
              providerReference: null,
              failureCode: 'PROVIDER_INITIATION_REJECTED',
              failureMessage,
              resolvedAt: new Date(),
            },
          });
          await tx.idempotencyKey.update({
            where: {
              userId_key_operation: {
                userId: actorUserId,
                key: normalizedKey,
                operation: 'wallet.topup',
              },
            },
            data: {
              responseJson: {
                paymentId: reservation.payment.id,
                purpose: PaymentPurpose.WALLET_TOP_UP,
                status: PaymentStatus.FAILED,
                retryable: true,
                failureCode: 'PROVIDER_INITIATION_REJECTED',
                failureMessage,
              },
              statusCode: 400,
              completedAt: new Date(),
            },
          });
        });
        throw error;
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.payment.updateMany({
            where: { id: reservation.payment.id, status: PaymentStatus.PENDING },
            data: {
              status: PaymentStatus.PROCESSING,
              provider: this.moolre.provider,
              providerReference: null,
              failureCode: 'PROVIDER_INITIATION_UNKNOWN',
              failureMessage: 'Provider initiation outcome is unknown; awaiting webhook reconciliation.',
              completedAt: null,
            },
          });
          await tx.paymentProviderAttempt.updateMany({
            where: { id: reservation.attemptId, status: PaymentStatus.PENDING },
            data: {
              status: PaymentStatus.PROCESSING,
              providerReference: null,
              failureCode: 'PROVIDER_INITIATION_UNKNOWN',
              failureMessage: 'Provider initiation outcome is unknown; awaiting webhook reconciliation.',
              resolvedAt: null,
            },
          });
        });
      } catch {
        // Provider outcome remains ambiguous; webhook reconciliation remains authoritative.
      }

      throw new ServiceUnavailableException(
        'Wallet top-up provider initiation outcome is unknown; the payment remains processing and requires reconciliation.',
      );
    }

    const response = {
      paymentId: reservation.payment.id,
      clientReference: reservation.payment.clientReference,
      status: PaymentStatus.PROCESSING,
      amount: reservation.payment.amount.toFixed(2),
      currency: reservation.payment.currency,
      provider: this.moolre.provider,
      providerReference: providerResult.providerReference,
      requiresOtp: providerResult.requiresOtp,
      sessionId: providerResult.sessionId ?? null,
      network,
      mock: providerResult.mock,
      purpose: PaymentPurpose.WALLET_TOP_UP,
    };

    const persistAcceptedResult = async () => this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: reservation.payment.id },
        data: {
          status: PaymentStatus.PROCESSING,
          provider: this.moolre.provider,
          providerReference: providerResult.providerReference,
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
      await tx.idempotencyKey.update({
        where: {
          userId_key_operation: {
            userId: actorUserId,
            key: normalizedKey,
            operation: 'wallet.topup',
          },
        },
        data: {
          responseJson: response,
          statusCode: 202,
          completedAt: new Date(),
        },
      });
    });

    try {
      await persistAcceptedResult();
      return response;
    } catch {
      try {
        await persistAcceptedResult();
        return response;
      } catch {
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.payment.updateMany({
              where: { id: reservation.payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },
              data: {
                status: PaymentStatus.PROCESSING,
                provider: this.moolre.provider,
                providerReference: providerResult.providerReference,
                failureCode: 'LOCAL_PERSISTENCE_UNKNOWN',
                failureMessage: 'Provider accepted the wallet top-up, but local settlement state is unknown; reconcile before retrying.',
              },
            });
            await tx.paymentProviderAttempt.updateMany({
              where: { id: reservation.attemptId, status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] } },
              data: {
                status: PaymentStatus.PROCESSING,
                providerReference: providerResult.providerReference,
                failureCode: 'LOCAL_PERSISTENCE_UNKNOWN',
                failureMessage: 'Provider accepted the wallet top-up, but local settlement state is unknown; reconcile before retrying.',
                resolvedAt: null,
                responsePayload: { ...response, persistenceOutcomeUnknown: true },
              },
            });
          });
        } catch {
          // Best-effort safety marker; webhook reconciliation remains authoritative.
        }
        throw new ServiceUnavailableException(
          'Wallet top-up provider accepted the request, but local state could not be persisted. Reconcile before retrying.',
        );
      }
    }
  }
}
