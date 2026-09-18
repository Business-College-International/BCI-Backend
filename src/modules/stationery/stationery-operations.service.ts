import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const MANAGEMENT_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
  RoleName.ACCOUNTANT,
]);

const STAFF_FULFILLABLE_STATUSES = new Set(['PAID']);

@Injectable()
export class StationeryOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrders(_actorUserId: string, roles: RoleName[], status?: string) {
    this.assertManagement(roles);
    return this.prisma.stationeryOrder.findMany({
      where: status ? { status } : undefined,
      orderBy: { orderedAt: 'desc' },
      take: 200,
      include: {
        lines: {
          include: {
            item: { select: { sku: true, name: true } },
          },
        },
      },
    });
  }

  async attachSuccessfulPayment(orderId: string, paymentId: string, actorUserId: string, roles: RoleName[]) {
    this.assertManagement(roles);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;

        const order = await tx.stationeryOrder.findUnique({
          where: { id: orderId },
          select: { id: true, orderNumber: true, studentId: true, guardianId: true, status: true, totalAmount: true, paymentId: true },
        });
        if (!order) throw new NotFoundException('Stationery order not found.');
        if (order.status !== 'DRAFT') throw new BadRequestException('Only draft stationery orders can receive a payment.');
        if (order.paymentId) throw new ConflictException('This stationery order is already linked to a payment.');

        const payment = await tx.payment.findUnique({
          where: { id: paymentId },
          select: { id: true, studentId: true, guardianId: true, amount: true, currency: true, purpose: true, status: true, completedAt: true, provider: true, providerReference: true },
        });
        if (!payment) throw new NotFoundException('Payment not found.');
        if (payment.status !== 'SUCCEEDED') throw new ConflictException('The payment must be successfully settled before it can be attached to a stationery order.');
        if (payment.purpose !== 'STATIONERY') throw new ConflictException('The payment is not a stationery payment.');
        if (payment.studentId !== order.studentId || payment.guardianId !== order.guardianId) {
          throw new ConflictException('The payment does not belong to the guardian and ward on this order.');
        }
        if (!payment.amount.equals(order.totalAmount)) throw new ConflictException('The payment amount does not match the stationery order total.');

        const existingOrder = await tx.stationeryOrder.findFirst({
          where: { paymentId: payment.id, id: { not: order.id } },
          select: { id: true, orderNumber: true },
        });
        if (existingOrder) throw new ConflictException('The payment is already linked to another stationery order.');

        const updated = await tx.stationeryOrder.update({
          where: { id: order.id },
          data: { paymentId: payment.id, status: 'PAID' },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'RECONCILE',
            entityType: 'StationeryOrder',
            entityId: order.id,
            beforeJson: { status: order.status, paymentId: null },
            afterJson: { status: updated.status, paymentId: payment.id, providerReference: payment.providerReference },
          },
        });

        return updated;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') throw new ConflictException('Stationery payment attachment conflicted with another financial operation. Please retry.');
      throw error;
    }
  }

  async markReadyForCollection(orderId: string, actorUserId: string, roles: RoleName[]) {
    this.assertManagement(roles);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM "StationeryOrder" WHERE id = ${orderId} FOR UPDATE`;
        const order = await tx.stationeryOrder.findUnique({
          where: { id: orderId },
          include: {
            lines: { select: { itemId: true, quantity: true, unitPrice: true, lineTotal: true } },
          },
        });
        if (!order) throw new NotFoundException('Stationery order not found.');
        if (!STAFF_FULFILLABLE_STATUSES.has(order.status)) {
          throw new BadRequestException(`Order ${order.orderNumber} is not ready for fulfillment from status ${order.status}.`);
        }
        if (!order.paymentId) {
          throw new BadRequestException('The order does not have a linked payment.');
        }

        const payment = await tx.payment.findUnique({
          where: { id: order.paymentId },
          select: { id: true, status: true, purpose: true, amount: true, studentId: true },
        });
        if (!payment || payment.status !== 'SUCCEEDED') {
          throw new ConflictException('The linked stationery payment is not successful.');
        }
        if (payment.purpose !== 'STATIONERY') {
          throw new ConflictException('The linked payment is not a stationery payment.');
        }
        if (payment.studentId !== order.studentId) {
          throw new ConflictException('The linked payment does not belong to the ward on this order.');
        }
        if (!payment.amount.equals(order.totalAmount)) {
          throw new ConflictException('The linked payment amount does not match the stationery order total.');
        }

        for (const line of order.lines) {
          const item = await tx.stationeryItem.findUnique({ where: { id: line.itemId } });
          if (!item) throw new NotFoundException(`Stationery item ${line.itemId} was not found.`);
          if (!item.isActive) throw new ConflictException(`Stationery item ${item.sku} is inactive.`);
          if (item.stockQty < line.quantity) {
            throw new ConflictException(`Insufficient stock for ${item.sku}. Available ${item.stockQty}, required ${line.quantity}.`);
          }
        }

        for (const line of order.lines) {
          const updated = await tx.stationeryItem.updateMany({
            where: { id: line.itemId, stockQty: { gte: line.quantity } },
            data: { stockQty: { decrement: line.quantity } },
          });
          if (updated.count !== 1) {
            throw new ConflictException('Stock changed while fulfilling the order. Please retry.');
          }
          await tx.stockMovement.create({
            data: {
              itemId: line.itemId,
              quantity: -line.quantity,
              movementType: 'ORDER_FULFILLMENT',
              referenceType: 'StationeryOrder',
              referenceId: order.id,
              performedBy: actorUserId,
            },
          });
        }

        const updatedOrder = await tx.stationeryOrder.update({
          where: { id: order.id },
          data: { status: 'READY_FOR_COLLECTION', fulfilledAt: new Date() },
          include: { lines: { include: { item: { select: { sku: true, name: true } } } } },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'UPDATE',
            entityType: 'StationeryOrder',
            entityId: order.id,
            beforeJson: { status: order.status },
            afterJson: { status: updatedOrder.status, fulfilledAt: updatedOrder.fulfilledAt },
          },
        });

        return updatedOrder;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Stationery stock changed concurrently. Please retry.');
      }
      throw error;
    }
  }

  async markCollected(orderId: string, actorUserId: string, roles: RoleName[]) {
    this.assertManagement(roles);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.stationeryOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Stationery order not found.');
      if (order.status !== 'READY_FOR_COLLECTION') throw new BadRequestException('Only ready stationery orders can be collected.');

      const updated = await tx.stationeryOrder.update({
        where: { id: order.id },
        data: { status: 'COLLECTED', collectedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'StationeryOrder',
          entityId: order.id,
          beforeJson: { status: order.status },
          afterJson: { status: updated.status, collectedAt: updated.collectedAt },
        },
      });
      return updated;
    });
  }

  async cancelDraft(orderId: string, actorUserId: string, roles: RoleName[]) {
    this.assertManagement(roles);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.stationeryOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Stationery order not found.');
      if (order.status !== 'DRAFT') throw new BadRequestException('Only draft stationery orders can be cancelled.');

      const updated = await tx.stationeryOrder.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'StationeryOrder',
          entityId: order.id,
          beforeJson: { status: order.status },
          afterJson: { status: updated.status },
        },
      });
      return updated;
    });
  }

  private assertManagement(roles: RoleName[]) {
    if (!roles.some((role) => MANAGEMENT_ROLES.has(role))) {
      throw new ForbiddenException('Stationery operational management is restricted.');
    }
  }
}
