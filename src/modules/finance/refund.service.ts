import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InvoiceStatus, PaymentPurpose, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MoolreDisbursementService } from '../payment-providers/moolre.disbursement.service';
import { RequestRefundDto } from './dto/request-refund.dto';
import { FinancialJournalService } from './financial-journal.service';

const FINANCE_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.ACCOUNTANT, RoleName.OFFICE]);
const REFUND_REFERENCE_PREFIX = 'bci-refund-';

@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disbursements: MoolreDisbursementService,
    private readonly journal: FinancialJournalService,
  ) {}

  async requestRefund(dto: RequestRefundDto, actorUserId: string, roles: RoleName[]) {
    this.assertManage(roles);
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Refund amount must be greater than zero.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${dto.paymentId} FOR UPDATE`;
        const payment = await tx.payment.findUnique({
          where: { id: dto.paymentId },
          include: {
            refunds: true,
            allocations: { select: { id: true, invoiceId: true, amount: true } },
          },
        });
        if (!payment) throw new NotFoundException('Payment not found.');
        if (payment.status !== PaymentStatus.SUCCEEDED) {
          throw new BadRequestException('Only succeeded payments can be refunded.');
        }
        if (payment.purpose === PaymentPurpose.FEE && payment.allocations.length !== 1) {
          throw new ConflictException('Fee refunds currently require a payment allocated to exactly one invoice.');
        }

        const priorRefunded = payment.refunds
          .filter((refund) => refund.status !== PaymentStatus.FAILED && refund.status !== PaymentStatus.CANCELLED)
          .reduce((sum, refund) => sum.plus(refund.amount), new Prisma.Decimal(0));
        const remaining = payment.amount.minus(priorRefunded);
        if (amount.gt(remaining)) {
          throw new ConflictException('Refund amount exceeds the unrefunded portion of the payment.');
        }

        const refund = await tx.refund.create({
          data: {
            paymentId: payment.id,
            amount,
            reason: dto.reason.trim(),
            requestedBy: actorUserId,
            status: PaymentStatus.PENDING,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'Refund',
            entityId: refund.id,
            afterJson: {
              paymentId: refund.paymentId,
              amount: refund.amount.toFixed(2),
              reason: refund.reason,
              status: refund.status,
              invoiceId: payment.allocations[0]?.invoiceId ?? null,
            },
          },
        });

        return refund;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Refund changed concurrently. Please retry the refund request.');
      }
      throw error;
    }
  }

  async approveRefund(refundId: string, actorUserId: string, roles: RoleName[]) {
    this.assertManage(roles);

    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (!refund) throw new NotFoundException('Refund not found.');
      if (refund.status !== PaymentStatus.PENDING || refund.approvedBy) {
        throw new ConflictException('Only pending, unapproved refunds can be approved.');
      }
      if (refund.requestedBy === actorUserId) {
        throw new ForbiddenException('Refund requester cannot approve their own refund.');
      }

      const transition = await tx.refund.updateMany({
        where: { id: refund.id, status: PaymentStatus.PENDING, approvedBy: null },
        data: { approvedBy: actorUserId },
      });
      if (transition.count !== 1) {
        throw new ConflictException('Refund was already approved by another user.');
      }

      const updated = await tx.refund.findUnique({ where: { id: refund.id } });
      if (!updated) throw new NotFoundException('Refund disappeared during approval.');

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'APPROVE',
          entityType: 'Refund',
          entityId: refund.id,
          beforeJson: { approvedBy: refund.approvedBy, status: refund.status },
          afterJson: { approvedBy: updated.approvedBy, status: updated.status },
        },
      });

      return updated;
    });
  }

  async executeRefund(refundId: string, actorUserId: string, roles: RoleName[]) {
    this.assertManage(roles);

    const reservation = await this.prisma.$transaction(async (tx) => {
      const refundLookup = await tx.refund.findUnique({
        where: { id: refundId },
        select: { paymentId: true },
      });
      if (!refundLookup) throw new NotFoundException('Refund not found.');

      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${refundLookup.paymentId} FOR UPDATE`;

      const current = await tx.refund.findUnique({
        where: { id: refundId },
        include: {
          payment: {
            select: {
              id: true,
              status: true,
              amount: true,
              purpose: true,
              guardianId: true,
              currency: true,
              refunds: { select: { id: true, amount: true, status: true } },
            },
          },
        },
      });
      if (!current) throw new NotFoundException('Refund not found.');
      if (current.status !== PaymentStatus.PENDING || !current.approvedBy) {
        throw new ConflictException('Only an approved pending refund can be executed.');
      }
      if (current.payment.status !== PaymentStatus.SUCCEEDED) {
        throw new ConflictException('The original payment is no longer successfully settled.');
      }

      const reservedAmount = current.payment.refunds
        .filter((item) => item.id !== current.id && item.status !== PaymentStatus.FAILED && item.status !== PaymentStatus.CANCELLED)
        .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
      if (reservedAmount.plus(current.amount).gt(current.payment.amount)) {
        throw new ConflictException('Refund execution would exceed the remaining refundable payment amount.');
      }

      const transition = await tx.refund.updateMany({
        where: { id: refundId, status: PaymentStatus.PENDING, approvedBy: { not: null } },
        data: { status: PaymentStatus.PROCESSING },
      });
      if (transition.count !== 1) throw new ConflictException('Refund is already being executed.');

      return {
        refundId: current.id,
        amount: current.amount.toString(),
        paymentId: current.payment.id,
        guardianId: current.payment.guardianId,
        purpose: current.payment.purpose,
        currency: current.payment.currency,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 10000,
    });

    const recipient = await this.resolveRecipientPhone(reservation.guardianId, reservation.paymentId);

    const referenceId = refundReference(reservation.refundId);
    let result: Awaited<ReturnType<MoolreDisbursementService['initiateTransfer']>>;
    try {
      result = await this.disbursements.initiateTransfer({
        referenceId,
        amountGhs: new Prisma.Decimal(reservation.amount).toFixed(2),
        recipientPhone: recipient,
        narration: `BCI refund ${reservation.refundId}`,
      });
    } catch {
      try {
        const status = await this.disbursements.getTransferStatus(referenceId);
        if (status.status === 'FAILED') {
          return this.failRefund(reservation.refundId, actorUserId, 'PROVIDER_REFUND_FAILED');
        }
        if (status.status === 'SUCCESSFUL') {
          return this.settleSuccessfulRefund(reservation.refundId, actorUserId, status.providerReference);
        }

        return this.prisma.refund.update({
          where: { id: reservation.refundId },
          data: { providerReference: status.providerReference },
        });
      } catch (statusError) {
        if (statusError instanceof ConflictException) throw statusError;
        throw new ServiceUnavailableException('Refund provider initiation outcome is unknown; the refund remains processing and requires reconciliation.');
      }
    }

    if (result.status === 'FAILED') {
      return this.failRefund(reservation.refundId, actorUserId, 'PROVIDER_REFUND_FAILED');
    }
    if (result.status === 'SUCCESSFUL') {
      return this.settleSuccessfulRefund(reservation.refundId, actorUserId, result.providerReference);
    }

    return this.prisma.refund.update({
      where: { id: reservation.refundId },
      data: { providerReference: result.providerReference },
    });
  }
  async reconcileRefund(refundId: string, actorUserId: string, roles: RoleName[]) {
    this.assertManage(roles);
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: { select: { id: true } } },
    });
    if (!refund) throw new NotFoundException('Refund not found.');
    if (refund.status === PaymentStatus.SUCCEEDED || refund.status === PaymentStatus.FAILED || refund.status === PaymentStatus.CANCELLED) {
      return refund;
    }
    if (refund.status !== PaymentStatus.PROCESSING) {
      throw new ConflictException('Only a processing refund can be reconciled.');
    }

    try {
      const result = await this.disbursements.getTransferStatus(refundReference(refund.id));
      if (result.status === 'PENDING') return refund;
      if (result.status === 'FAILED') return this.failRefund(refund.id, actorUserId, 'PROVIDER_REFUND_FAILED');
      return this.settleSuccessfulRefund(refund.id, actorUserId, result.providerReference);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('Refund reconciliation is temporarily unavailable.');
    }
  }

  async listRefunds(roles: RoleName[]) {
    this.assertManage(roles);
    return this.prisma.refund.findMany({
      include: {
        payment: {
          select: {
            id: true,
            studentId: true,
            guardianId: true,
            amount: true,
            currency: true,
            purpose: true,
            status: true,
            provider: true,
            providerReference: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: 500,
    });
  }

  private async settleSuccessfulRefund(refundId: string, actorUserId: string, providerReference: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const refund = await tx.refund.findUnique({
          where: { id: refundId },
          include: {
            payment: {
              include: {
                refunds: true,
                allocations: { include: { invoice: { include: { lines: true } } } },
              },
            },
          },
        });
        if (!refund) throw new NotFoundException('Refund not found.');
        if (refund.status === PaymentStatus.SUCCEEDED) return refund;
        if (refund.status !== PaymentStatus.PROCESSING) throw new ConflictException('Refund is not awaiting settlement.');

        const previousRefunded = refund.payment.refunds
          .filter((item) => item.id !== refund.id && item.status === PaymentStatus.SUCCEEDED)
          .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
        if (previousRefunded.plus(refund.amount).gt(refund.payment.amount)) {
          throw new ConflictException('Refund settlement would exceed the original payment amount.');
        }

        await tx.refund.update({
          where: { id: refund.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            providerReference,
            completedAt: new Date(),
          },
        });

        const totalRefunded = previousRefunded.plus(refund.amount);
        if (totalRefunded.gte(refund.payment.amount)) {
          await tx.payment.update({ where: { id: refund.paymentId }, data: { status: PaymentStatus.REFUNDED } });
        }

        if (refund.payment.purpose === PaymentPurpose.FEE) {
          if (refund.payment.allocations.length !== 1) {
            throw new ConflictException('A fee refund requires exactly one payment allocation.');
          }
          const allocation = refund.payment.allocations[0];
          const invoice = allocation.invoice;
          const invoiceSettled = await this.invoiceNetSettled(tx, invoice.id);
          if (invoice.status !== InvoiceStatus.VOID) {
            const due = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
            const nextStatus = invoiceSettled.gte(due)
              ? InvoiceStatus.PAID
              : invoiceSettled.gt(0)
                ? InvoiceStatus.PARTIALLY_PAID
                : InvoiceStatus.OPEN;
            await tx.studentInvoice.update({ where: { id: invoice.id }, data: { status: nextStatus } });
          }
        }

        const debitAccount = refundAccountForPurpose(refund.payment.purpose);
        await this.journal.recordBalancedEntry([
          {
            accountCode: debitAccount,
            direction: 'DEBIT',
            amount: refund.amount.toFixed(2),
            currency: refund.payment.currency,
            referenceType: 'Refund',
            referenceId: refund.id,
            description: `Refund ${refund.id}`,
          },
          {
            accountCode: 'CASH',
            direction: 'CREDIT',
            amount: refund.amount.toFixed(2),
            currency: refund.payment.currency,
            referenceType: 'Refund',
            referenceId: refund.id,
            description: `Refund ${refund.id}`,
          },
        ], actorUserId, tx);

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'RECONCILE',
            entityType: 'Refund',
            entityId: refund.id,
            afterJson: {
              status: PaymentStatus.SUCCEEDED,
              providerReference,
              amount: refund.amount.toFixed(2),
              paymentStatus: totalRefunded.gte(refund.payment.amount) ? PaymentStatus.REFUNDED : PaymentStatus.SUCCEEDED,
            },
          },
        });

        return tx.refund.findUnique({ where: { id: refund.id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Refund settlement changed concurrently. Please retry reconciliation.');
      }
      throw error;
    }
  }

  private async failRefund(refundId: string, actorUserId: string, failureCode: string) {
    const updated = await this.prisma.refund.updateMany({
      where: { id: refundId, status: PaymentStatus.PROCESSING },
      data: { status: PaymentStatus.FAILED },
    });
    if (updated.count !== 1) throw new ConflictException('Refund is no longer processing.');
    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'RECONCILE',
        entityType: 'Refund',
        entityId: refundId,
        afterJson: { status: PaymentStatus.FAILED, failureCode },
      },
    });
    return this.prisma.refund.findUnique({ where: { id: refundId } });
  }

  private async invoiceNetSettled(tx: Prisma.TransactionClient, invoiceId: string) {
    const invoice = await tx.studentInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        allocations: {
          include: {
            payment: { include: { refunds: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found.');

    return invoice.allocations.reduce((sum, allocation) => {
      if (allocation.payment.status !== PaymentStatus.SUCCEEDED && allocation.payment.status !== PaymentStatus.REFUNDED) return sum;
      const refunded = allocation.payment.refunds
        .filter((refund) => refund.status === PaymentStatus.SUCCEEDED)
        .reduce((refundSum, refund) => refundSum.plus(refund.amount), new Prisma.Decimal(0));
      return sum.plus(Prisma.Decimal.max(allocation.amount.minus(refunded), 0));
    }, new Prisma.Decimal(0));
  }

  private async resolveRecipientPhone(guardianId: string | null, paymentId: string) {
    if (guardianId) {
      const person = await this.prisma.person.findUnique({ where: { id: guardianId }, select: { phone: true } });
      if (person?.phone) return person.phone;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { studentId: true },
    });
    if (payment?.studentId) {
      const guardian = await this.prisma.guardianStudent.findFirst({
        where: { studentId: payment.studentId, isPrimaryContact: true },
        select: { guardianId: true },
      });
      if (guardian) {
        const person = await this.prisma.person.findUnique({ where: { id: guardian.guardianId }, select: { phone: true } });
        if (person?.phone) return person.phone;
      }
    }

    throw new ConflictException('A guardian phone number is required before a refund can be disbursed.');
  }

  private assertManage(roles: RoleName[]) {
    if (!roles.some((role) => FINANCE_ROLES.has(role))) {
      throw new ForbiddenException('Refund management requires finance-management access.');
    }
  }
}

function refundReference(refundId: string) {
  return `${REFUND_REFERENCE_PREFIX}${refundId}`;
}

function refundAccountForPurpose(purpose: PaymentPurpose) {
  switch (purpose) {
    case PaymentPurpose.FEE:
      return 'FEES';
    case PaymentPurpose.WALLET_TOP_UP:
      return 'WALLET_LIABILITY';
    case PaymentPurpose.STATIONERY:
      return 'STATIONERY_REVENUE';
    default:
      return 'REFUNDS';
  }
}
