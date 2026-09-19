import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DisbursementStatus, PayrollPeriodStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MoolreDisbursementService } from '../payment-providers/moolre.disbursement.service';

const MANAGEMENT_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
  RoleName.PRINCIPAL,
]);

@Injectable()
export class PayrollDisbursementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disbursements: MoolreDisbursementService,
  ) {}

  async initiate(entryId: string, actorUserId: string, roles: RoleName[], idempotencyKey: string) {
    this.requireManagement(roles);
    const key = idempotencyKey?.trim();
    if (!key) throw new BadRequestException('An Idempotency-Key header is required for payroll disbursement.');

    let reservation: {
      attemptId: string;
      referenceId: string;
      periodId: string;
      entryId: string;
      amount: string;
      phone: string;
      network: string | undefined;
      reconcileOnly?: boolean;
    };

    try {
      reservation = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PayrollEntry" WHERE id = ${entryId} FOR UPDATE`;

        const entry = await tx.payrollEntry.findUnique({
          where: { id: entryId },
          include: {
            period: { select: { id: true, status: true, code: true } },
            staff: { select: { personId: true, staffIdNo: true, employmentStatus: true, person: { select: { phone: true } } } },
            disbursementAttempts: {
              where: { purpose: 'PAYROLL' },
              orderBy: { requestedAt: 'desc' },
            },
          },
        });

        if (!entry) throw new NotFoundException('Payroll entry not found.');
        if (entry.period.status !== PayrollPeriodStatus.APPROVED) {
          throw new BadRequestException('Only an approved payroll period can be disbursed.');
        }
        if (entry.status !== 'approved') throw new BadRequestException('Payroll entry is not approved.');
        if (entry.staff.employmentStatus !== 'active') throw new ConflictException('Payroll cannot be disbursed to inactive staff.');
        if (!entry.staff.person.phone) throw new ConflictException('Staff phone number is required before payroll disbursement.');

        const succeeded = entry.disbursementAttempts
          .filter((attempt) => attempt.status === DisbursementStatus.SUCCEEDED)
          .reduce((sum, attempt) => sum.plus(attempt.amount), new Prisma.Decimal(0));
        const processing = entry.disbursementAttempts.find((attempt) => attempt.status === DisbursementStatus.PROCESSING);
        if (succeeded.gte(entry.netPay)) {
          throw new ConflictException('This payroll entry has already been fully disbursed.');
        }
        if (processing) {
          if (processing.idempotencyKey === key) {
            return {
              attemptId: processing.id,
              referenceId: `bci-payroll-${entry.id}-${key}`,
              periodId: entry.period.id,
              reconcileOnly: true,
              entryId: entry.id,
              amount: entry.netPay.minus(succeeded).toFixed(2),
              phone: entry.staff.person.phone,
              network: undefined,
            };
          }
          throw new ConflictException('A payroll disbursement is already processing for this entry.');
        }

        const remaining = entry.netPay.minus(succeeded);
        if (remaining.lte(0)) throw new ConflictException('No remaining payroll amount is available for disbursement.');

        const attempt = await tx.disbursementAttempt.create({
          data: {
            payrollPeriodId: entry.period.id,
            payrollEntryId: entry.id,
            staffId: entry.staff.personId,
            purpose: 'PAYROLL',
            amount: remaining,
            status: DisbursementStatus.PROCESSING,
            idempotencyKey: key,
            provider: 'MOOLRE',
          },
        });

        return {
          attemptId: attempt.id,
          referenceId: `bci-payroll-${entry.id}-${key}`,
          periodId: entry.period.id,
          entryId: entry.id,
          amount: remaining.toFixed(2),
          phone: entry.staff.person.phone,
          network: undefined,
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Payroll disbursement changed concurrently. Please retry.');
      }
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('This payroll disbursement request has already been reserved.');
      }
      throw error;
    }

    if (reservation.reconcileOnly) {
      try {
        const status = await this.disbursements.getTransferStatus(reservation.referenceId);
        return this.applyProviderStatus(
          reservation.attemptId,
          reservation.periodId,
          status.status,
          status.providerReference,
          actorUserId,
        );
      } catch {
        throw new ServiceUnavailableException(
          'An existing payroll disbursement is still processing. Provider status could not be verified safely.',
        );
      }
    }

    let provider;
    try {
      provider = await this.disbursements.initiateTransfer({
        referenceId: reservation.referenceId,
        amountGhs: reservation.amount,
        recipientPhone: reservation.phone,
        narration: `BCI payroll ${reservation.entryId}`,
      });
    } catch (error) {
      try {
        const status = await this.disbursements.getTransferStatus(reservation.referenceId);
        return this.applyProviderStatus(reservation.attemptId, reservation.periodId, status.status, status.providerReference, actorUserId);
      } catch {
        await this.prisma.disbursementAttempt.updateMany({
          where: { id: reservation.attemptId, status: DisbursementStatus.PROCESSING },
          data: {
            failureCode: 'PROVIDER_INITIATION_UNKNOWN',
            failureMessage: error instanceof Error ? error.message : 'Provider initiation outcome is unknown.',
          },
        });
        throw new ServiceUnavailableException('Payroll provider initiation outcome is unknown; the disbursement remains processing and requires reconciliation.');
      }
    }

    return this.applyProviderStatus(
      reservation.attemptId,
      reservation.periodId,
      provider.status,
      provider.providerReference,
      actorUserId,
    );
  }

  async reconcile(attemptId: string, actorUserId: string, roles: RoleName[]) {
    this.requireManagement(roles);
    const attempt = await this.prisma.disbursementAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, status: true, providerReference: true, idempotencyKey: true, payrollPeriodId: true, payrollEntryId: true },
    });
    if (!attempt) throw new NotFoundException('Payroll disbursement attempt not found.');
    if (!attempt.payrollPeriodId || !attempt.payrollEntryId) throw new ConflictException('Disbursement attempt is not linked to payroll.');

    if (attempt.status === DisbursementStatus.SUCCEEDED || attempt.status === DisbursementStatus.FAILED) {
      return {
        attemptId: attempt.id,
        status: attempt.status,
        providerReference: attempt.providerReference,
      };
    }

    const referenceId = attempt.providerReference
      ?? (attempt.payrollEntryId && attempt.idempotencyKey
        ? `bci-payroll-${attempt.payrollEntryId}-${attempt.idempotencyKey}`
        : null);
    if (!referenceId) {
      throw new ConflictException('The processing payroll disbursement has no provider reference or deterministic external reference. Reconciliation requires manual review.');
    }
    let status;
    try {
      status = await this.disbursements.getTransferStatus(referenceId);
    } catch {
      throw new ServiceUnavailableException('Payroll disbursement status could not be verified. Reconciliation is required before another attempt.');
    }
    return this.applyProviderStatus(attempt.id, attempt.payrollPeriodId, status.status, status.providerReference, actorUserId);
  }

  private async applyProviderStatus(
    attemptId: string,
    periodId: string,
    providerStatus: 'PENDING' | 'SUCCESSFUL' | 'FAILED',
    providerReference: string,
    actorUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PayrollPeriod" WHERE id = ${periodId} FOR UPDATE`;

      const attempt = await tx.disbursementAttempt.findUnique({
        where: { id: attemptId },
        include: { payrollEntry: true },
      });
      if (!attempt) throw new NotFoundException('Payroll disbursement attempt not found.');

      if (providerStatus === 'PENDING') {
        await tx.disbursementAttempt.updateMany({
          where: { id: attemptId, status: DisbursementStatus.PROCESSING },
          data: { providerReference },
        });
        return { attemptId, status: DisbursementStatus.PROCESSING, providerReference };
      }

      const nextStatus = providerStatus === 'SUCCESSFUL'
        ? DisbursementStatus.SUCCEEDED
        : DisbursementStatus.FAILED;

      const completedAt = new Date();
      const updated = await tx.disbursementAttempt.updateMany({
        where: { id: attemptId, status: DisbursementStatus.PROCESSING },
        data: {
          status: nextStatus,
          providerReference,
          completedAt,
          failureCode: nextStatus === DisbursementStatus.FAILED ? 'PROVIDER_REFUSED' : null,
          failureMessage: nextStatus === DisbursementStatus.FAILED ? 'Provider reported a failed payroll disbursement.' : null,
        },
      });
      if (updated.count !== 1) {
        const current = await tx.disbursementAttempt.findUnique({ where: { id: attemptId }, select: { status: true, providerReference: true } });
        return { attemptId, status: current?.status ?? nextStatus, providerReference: current?.providerReference ?? providerReference };
      }

      if (nextStatus === DisbursementStatus.SUCCEEDED && attempt.payrollEntryId) {
        const entry = await tx.payrollEntry.findUnique({
          where: { id: attempt.payrollEntryId },
          select: { id: true, netPay: true, disbursementAttempts: { where: { purpose: 'PAYROLL' }, select: { amount: true, status: true } } },
        });
        if (!entry) throw new NotFoundException('Payroll entry not found for disbursement.');
        const paid = entry.disbursementAttempts
          .filter((item) => item.status === DisbursementStatus.SUCCEEDED)
          .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
        if (paid.gte(entry.netPay)) {
          await tx.payrollEntry.updateMany({
            where: { id: entry.id, status: 'approved' },
            data: { status: 'paid' },
          });
        }

        const periodEntries = await tx.payrollEntry.findMany({
          where: { periodId },
          select: { id: true, netPay: true, status: true, disbursementAttempts: { where: { purpose: 'PAYROLL' }, select: { amount: true, status: true } } },
        });
        const fullyPaid = periodEntries.length > 0 && periodEntries.every((item) => {
          const total = item.disbursementAttempts
            .filter((attempt) => attempt.status === DisbursementStatus.SUCCEEDED)
            .reduce((sum, disb) => sum.plus(disb.amount), new Prisma.Decimal(0));
          return total.gte(item.netPay);
        });
        if (fullyPaid) {
          await tx.payrollPeriod.updateMany({
            where: { id: periodId, status: PayrollPeriodStatus.APPROVED },
            data: { status: PayrollPeriodStatus.PAID, paidAt: completedAt },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: nextStatus === DisbursementStatus.SUCCEEDED ? 'DISBURSE' : 'RECONCILE',
          entityType: 'DisbursementAttempt',
          entityId: attemptId,
          afterJson: { status: nextStatus, providerReference },
        },
      });

      return { attemptId, status: nextStatus, providerReference };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 10000,
    });
  }

  private requireManagement(roles: RoleName[]) {
    if (!roles.some((role) => MANAGEMENT_ROLES.has(role))) {
      throw new ForbiddenException('Payroll disbursement access is restricted.');
    }
  }
}
