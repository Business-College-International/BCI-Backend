import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateStationeryItemDto } from './dto/create-stationery-item.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateStationeryOrderDto } from './dto/create-stationery-order.dto';

const PRIVILEGED_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
  RoleName.ACCOUNTANT,
]);

@Injectable()
export class StationeryService {
  constructor(private readonly prisma: PrismaService) {}

  async listCatalog(includeInactive = false) {
    return this.prisma.stationeryItem.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, sku: true, name: true, price: true, stockQty: true, isActive: true },
    });
  }

  async createItem(dto: CreateStationeryItemDto, actorUserId: string, roles: RoleName[]) {
    this.assertManager(roles);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.stationeryItem.create({
          data: {
            sku: dto.sku.trim().toUpperCase(),
            name: dto.name.trim(),
            price: new Prisma.Decimal(dto.price),
            isActive: dto.isActive ?? true,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'StationeryItem',
            entityId: item.id,
            afterJson: { sku: item.sku, name: item.name, price: item.price.toString() },
          },
        });
        return item;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A stationery item with this SKU already exists.');
      }
      throw error;
    }
  }

  async adjustStock(itemId: string, dto: AdjustStockDto, actorUserId: string, roles: RoleName[]) {
    this.assertManager(roles);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stationeryItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException('Stationery item not found.');

      const movementType = dto.movementType.trim().toUpperCase();
      if (!['RECEIPT', 'COUNT_CORRECTION'].includes(movementType)) {
        throw new BadRequestException('Supported positive stock movements are RECEIPT and COUNT_CORRECTION.');
      }

      const updated = await tx.stationeryItem.update({
        where: { id: itemId },
        data: { stockQty: { increment: dto.quantity } },
      });

      await tx.stockMovement.create({
        data: {
          itemId,
          quantity: dto.quantity,
          movementType,
          performedBy: actorUserId,
          note: dto.note.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'StationeryItem',
          entityId: itemId,
          beforeJson: { stockQty: item.stockQty },
          afterJson: { stockQty: updated.stockQty, movementType, quantity: dto.quantity },
        },
      });

      return updated;
    });
  }

  async createDraftOrder(dto: CreateStationeryOrderDto, actorUserId: string, roles: RoleName[]) {
    if (!roles.includes(RoleName.GUARDIAN)) {
      throw new ForbiddenException('Only guardians can create a stationery order for a ward.');
    }

    return this.prisma.$transaction(async (tx) => {
      const guardian = await tx.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
      if (!guardian) throw new ForbiddenException('Guardian profile not found.');

      const link = await tx.guardianStudent.findUnique({
        where: { guardianId_studentId: { guardianId: guardian.personId, studentId: dto.studentId } },
        select: { canPayFees: true },
      });
      if (!link || !link.canPayFees) {
        throw new ForbiddenException('This guardian is not permitted to purchase items for this ward.');
      }

      const uniqueItemIds = [...new Set(dto.lines.map((line) => line.itemId))];
      if (uniqueItemIds.length !== dto.lines.length) {
        throw new BadRequestException('Duplicate stationery items are not allowed in one order.');
      }

      const items = await tx.stationeryItem.findMany({ where: { id: { in: uniqueItemIds }, isActive: true } });
      if (items.length !== uniqueItemIds.length) throw new BadRequestException('One or more stationery items are unavailable.');

      const byId = new Map(items.map((item) => [item.id, item]));
      let total = new Prisma.Decimal(0);
      const lines = dto.lines.map((line) => {
        const item = byId.get(line.itemId)!;
        const lineTotal = item.price.mul(line.quantity);
        total = total.add(lineTotal);
        return { itemId: item.id, quantity: line.quantity, unitPrice: item.price, lineTotal };
      });

      const order = await tx.stationeryOrder.create({
        data: {
          orderNumber: `ST-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          studentId: dto.studentId,
          guardianId: guardian.personId,
          status: 'DRAFT',
          totalAmount: total,
          lines: { create: lines },
        },
        include: { lines: { include: { item: { select: { sku: true, name: true } } } } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'StationeryOrder',
          entityId: order.id,
          afterJson: { studentId: dto.studentId, totalAmount: total.toString(), lineCount: lines.length, status: 'DRAFT' },
        },
      });

      return order;
    });
  }

  async listMyOrders(actorUserId: string, roles: RoleName[]) {
    if (!roles.includes(RoleName.GUARDIAN)) throw new ForbiddenException('Guardian access is required.');
    const guardian = await this.prisma.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!guardian) throw new ForbiddenException('Guardian profile not found.');

    return this.prisma.stationeryOrder.findMany({
      where: { guardianId: guardian.personId },
      orderBy: { orderedAt: 'desc' },
      include: {
        lines: { include: { item: { select: { sku: true, name: true } } } },
      },
    });
  }

  private assertManager(roles: RoleName[]) {
    if (!roles.some((role) => PRIVILEGED_ROLES.has(role))) {
      throw new ForbiddenException('Stationery management access is restricted.');
    }
  }
}
