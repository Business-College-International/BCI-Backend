import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { RequestRefundDto } from './dto/request-refund.dto';

const FINANCE_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.ACCOUNTANT, RoleName.OFFICE]);

@Injectable()
export class RefundService {
  constructor(private readonly prisma: PrismaService) {}

  async requestRefund(dto: RequestRefundDto, actorUserId: string, roles: RoleName[]) {
    this.assertManage(roles);
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Refund amount must be greater than zero.');

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: dto.paymentId },
        include: { refunds: true },
      });
      if (!payment) throw new NotFoundException('Payment not found.');
      if (payment.status !== PaymentStatus.SUCCEEDED) {
        throw new BadRequestException('Only succeeded payments can be refunded.');
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
          },
        },
      });

      return refund;
    });
  }

  async approveRefund(refundId: string, actorUserId: string, roles: RoleName[]) {
    this.assertManage(roles);

    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (!refund) throw new NotFoundException('Refund not found.');
      if (refund.status !== PaymentStatus.PENDING) {
        throw new ConflictException('Only pending refunds can be approved.');
      }
      if (refund.requestedBy === actorUserId) {
        throw new ForbiddenException('Refund requester cannot approve their own refund.');
      }

      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: { approvedBy: actorUserId },
      });

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

  private assertManage(roles: RoleName[]) {
    if (!roles.some((role) => FINANCE_ROLES.has(role))) {
      throw new ForbiddenException('Refund management requires finance-management access.');
    }
  }
}
