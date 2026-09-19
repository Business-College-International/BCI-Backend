import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentPurpose, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { CreateStationeryItemDto } from './dto/create-stationery-item.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateStationeryOrderDto } from './dto/create-stationery-order.dto';
import { StationeryPaymentDto } from './dto/stationery-payment.dto';
import { MoolreAdapter } from '../payment-providers/moolre.adapter';

const PRIVILEGED_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT]);

@Injectable()
export class StationeryService {
  constructor(private readonly prisma: PrismaService, private readonly moolre: MoolreAdapter) {}

  async listCatalog(includeInactive = false) {
    return this.prisma.stationeryItem.findMany({ where: includeInactive ? undefined : { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, sku: true, name: true, price: true, stockQty: true, isActive: true } });
  }

  async createItem(dto: CreateStationeryItemDto, actorUserId: string, roles: RoleName[]) {
    this.assertManager(roles);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.stationeryItem.create({ data: { sku: dto.sku.trim().toUpperCase(), name: dto.name.trim(), price: new Prisma.Decimal(dto.price), isActive: dto.isActive ?? true } });
        await tx.auditLog.create({ data: { actorUserId, action: 'CREATE', entityType: 'StationeryItem', entityId: item.id, afterJson: { sku: item.sku, name: item.name, price: item.price.toString() } } });
        return item;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A stationery item with this SKU already exists.');
      throw error;
    }
  }

  async adjustStock(itemId: string, dto: AdjustStockDto, actorUserId: string, roles: RoleName[]) {
    this.assertManager(roles);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.stationeryItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException('Stationery item not found.');
      const movementType = dto.movementType.trim().toUpperCase();
      if (!['RECEIPT', 'COUNT_CORRECTION'].includes(movementType)) throw new BadRequestException('Supported positive stock movements are RECEIPT and COUNT_CORRECTION.');
      const updated = await tx.stationeryItem.update({ where: { id: itemId }, data: { stockQty: { increment: dto.quantity } } });
      await tx.stockMovement.create({ data: { itemId, quantity: dto.quantity, movementType, performedBy: actorUserId, referenceType: 'MANUAL_STOCK_ADJUSTMENT', referenceId: dto.note.trim() || undefined } });
      await tx.auditLog.create({ data: { actorUserId, action: 'UPDATE', entityType: 'StationeryItem', entityId: itemId, beforeJson: { stockQty: item.stockQty }, afterJson: { stockQty: updated.stockQty, movementType, quantity: dto.quantity, note: dto.note.trim() } } });
      return updated;
    });
  }

  async createDraftOrder(dto: CreateStationeryOrderDto, actorUserId: string, roles: RoleName[]) {
    if (!roles.includes(RoleName.GUARDIAN)) throw new ForbiddenException('Only guardians can create a stationery order for a ward.');
    return this.prisma.$transaction(async (tx) => {
      const guardian = await tx.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
      if (!guardian) throw new ForbiddenException('Guardian profile not found.');
      const link = await tx.guardianStudent.findUnique({ where: { guardianId_studentId: { guardianId: guardian.personId, studentId: dto.studentId } }, select: { canPayFees: true } });
      if (!link || !link.canPayFees) throw new ForbiddenException('This guardian is not permitted to purchase items for this ward.');
      const uniqueItemIds = [...new Set(dto.lines.map((line) => line.itemId))];
      if (uniqueItemIds.length !== dto.lines.length) throw new BadRequestException('Duplicate stationery items are not allowed in one order.');
      const items = await tx.stationeryItem.findMany({ where: { id: { in: uniqueItemIds }, isActive: true } });
      if (items.length !== uniqueItemIds.length) throw new BadRequestException('One or more stationery items are unavailable.');
      const byId = new Map(items.map((item) => [item.id, item]));
      let total = new Prisma.Decimal(0);
      const lines = dto.lines.map((line) => { const item = byId.get(line.itemId)!; const lineTotal = item.price.mul(line.quantity); total = total.add(lineTotal); return { itemId: item.id, quantity: line.quantity, unitPrice: item.price, lineTotal }; });
      const order = await tx.stationeryOrder.create({ data: { orderNumber: `ST-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, studentId: dto.studentId, guardianId: guardian.personId, status: 'DRAFT', totalAmount: total, lines: { create: lines } }, include: { lines: { include: { item: { select: { sku: true, name: true } } } } } });
      await tx.auditLog.create({ data: { actorUserId, action: 'CREATE', entityType: 'StationeryOrder', entityId: order.id, afterJson: { studentId: dto.studentId, totalAmount: total.toString(), lineCount: lines.length, status: 'DRAFT' } } });
      return order;
    });
  }

  async listMyOrders(actorUserId: string, roles: RoleName[]) {
    if (!roles.includes(RoleName.GUARDIAN)) throw new ForbiddenException('Guardian access is required.');
    const guardian = await this.prisma.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!guardian) throw new ForbiddenException('Guardian profile not found.');
    return this.prisma.stationeryOrder.findMany({ where: { guardianId: guardian.personId }, orderBy: { orderedAt: 'desc' }, include: { lines: { include: { item: { select: { sku: true, name: true } } } } } });
  }

  async initiatePayment(orderId: string, dto: StationeryPaymentDto, actorUserId: string, roles: RoleName[], idempotencyKey: string) {
    if (!roles.includes(RoleName.GUARDIAN)) throw new ForbiddenException('Only guardians can initiate a stationery payment for a ward.');
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey) throw new ConflictException('An Idempotency-Key header is required for stationery payment initiation.');

    const network = dto.network?.trim().toUpperCase() || null;
    const requestHash = createHash('sha256').update(JSON.stringify({ orderId, network, callbackUrl: dto.callbackUrl ?? null })).digest('hex');

    let reservation: any;
    try {
      reservation = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "StationeryOrder" WHERE id = ${orderId} FOR UPDATE`;
        const existingKey = await tx.idempotencyKey.findUnique({
          where: { userId_key_operation: { userId: actorUserId, key: normalizedKey, operation: 'stationery.payment' } },
        });
        if (existingKey) {
          if (existingKey.requestHash !== requestHash) throw new ConflictException('The stationery payment Idempotency-Key was already used with different parameters.');
          if (existingKey.responseJson) return { existing: existingKey.responseJson as Record<string, unknown> };
          throw new ConflictException('An identical stationery payment initiation is already in progress.');
        }

        const guardian = await tx.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
        if (!guardian) throw new ForbiddenException('Guardian profile not found.');
        const order = await tx.stationeryOrder.findUnique({
          where: { id: orderId },
          select: { id: true, orderNumber: true, studentId: true, guardianId: true, status: true, totalAmount: true, paymentId: true },
        });
        if (!order) throw new NotFoundException('Stationery order not found.');
        if (order.guardianId !== guardian.personId) throw new ForbiddenException('This order does not belong to the current guardian.');
        if (order.status !== 'DRAFT') throw new BadRequestException('Only draft stationery orders can be paid.');
        if (order.paymentId) {
          const linked = await tx.payment.findUnique({ where: { id: order.paymentId }, select: { id: true, status: true, purpose: true } });
          if (linked?.status === PaymentStatus.SUCCEEDED && linked.purpose === PaymentPurpose.STATIONERY) throw new ConflictException('This stationery order already has a successful payment.');
          throw new ConflictException('This stationery order already has a payment attempt in progress and requires reconciliation.');
        }
        const person = await tx.person.findUnique({ where: { id: guardian.personId }, select: { firstName: true, lastName: true, phone: true } });
        if (!person?.phone) throw new ConflictException('A guardian phone number is required before initiating a stationery payment.');

        const payment = await tx.payment.create({
          data: {
            studentId: order.studentId,
            guardianId: order.guardianId,
            amount: order.totalAmount,
            purpose: PaymentPurpose.STATIONERY,
            status: PaymentStatus.PENDING,
            clientReference: 'bci-stationery-' + order.id + '-' + randomBytes(10).toString('hex'),
            idempotencyKey: normalizedKey,
          },
        });
        const attempt = await tx.paymentProviderAttempt.create({ data: { paymentId: payment.id, provider: this.moolre.provider, status: PaymentStatus.PENDING } });
        await tx.stationeryOrder.update({ where: { id: order.id }, data: { paymentId: payment.id } });
        await tx.idempotencyKey.create({ data: { userId: actorUserId, key: normalizedKey, operation: 'stationery.payment', requestHash } });
        await tx.auditLog.create({
          data: {
            actorUserId, action: 'CREATE', entityType: 'Payment', entityId: payment.id,
            afterJson: { orderId: order.id, orderNumber: order.orderNumber, amount: payment.amount.toFixed(2), purpose: payment.purpose, clientReference: payment.clientReference, reservation: true },
          },
        });
        return {
          payment,
          attemptId: attempt.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customer: { name: (person.firstName + ' ' + person.lastName).trim(), phone: person.phone, ...(network ? { network } : {}) },
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A stationery payment attempt already exists for this request.');
      throw error;
    }
    if ('existing' in reservation) return reservation.existing;

    let providerResult: Awaited<ReturnType<MoolreAdapter['initiatePayment']>>;
    try {
      providerResult = await this.moolre.initiatePayment({
        clientReference: reservation.payment.clientReference!,
        amount: reservation.payment.amount.toFixed(2),
        currency: reservation.payment.currency,
        purpose: PaymentPurpose.STATIONERY,
        callbackUrl: dto.callbackUrl ?? '',
        customer: reservation.customer,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        const message = error.message;
        await this.prisma.$transaction(async (tx) => {
          await tx.payment.update({ where: { id: reservation.payment.id }, data: { status: PaymentStatus.FAILED, provider: this.moolre.provider, failureCode: 'PROVIDER_INITIATION_REJECTED', failureMessage: message, completedAt: new Date() } });
          await tx.paymentProviderAttempt.update({ where: { id: reservation.attemptId }, data: { status: PaymentStatus.FAILED, failureCode: 'PROVIDER_INITIATION_REJECTED', failureMessage: message, resolvedAt: new Date() } });
          await tx.stationeryOrder.updateMany({ where: { id: reservation.orderId, paymentId: reservation.payment.id, status: 'DRAFT' }, data: { paymentId: null } });
          await tx.idempotencyKey.update({ where: { userId_key_operation: { userId: actorUserId, key: normalizedKey, operation: 'stationery.payment' } }, data: { responseJson: { paymentId: reservation.payment.id, orderId: reservation.orderId, status: PaymentStatus.FAILED, retryable: true, failureCode: 'PROVIDER_INITIATION_REJECTED', failureMessage: message }, statusCode: 400, completedAt: new Date() } });
        });
        throw error;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: reservation.payment.id }, data: { status: PaymentStatus.PROCESSING, provider: this.moolre.provider, failureCode: 'PROVIDER_INITIATION_UNKNOWN', failureMessage: 'Provider initiation outcome is unknown; awaiting webhook reconciliation.' } });
        await tx.paymentProviderAttempt.update({ where: { id: reservation.attemptId }, data: { status: PaymentStatus.PROCESSING, failureCode: 'PROVIDER_INITIATION_UNKNOWN', failureMessage: 'Provider initiation outcome is unknown; awaiting webhook reconciliation.', resolvedAt: null } });
      });
      throw new ServiceUnavailableException('Stationery payment provider initiation outcome is unknown; the payment remains processing and requires reconciliation.');
    }

    const response = {
      paymentId: reservation.payment.id, orderId: reservation.orderId, orderNumber: reservation.orderNumber,
      clientReference: reservation.payment.clientReference, status: PaymentStatus.PROCESSING,
      amount: reservation.payment.amount.toFixed(2), currency: reservation.payment.currency, provider: this.moolre.provider,
      providerReference: providerResult.providerReference, requiresOtp: providerResult.requiresOtp,
      sessionId: providerResult.sessionId ?? null, network, mock: providerResult.mock, purpose: PaymentPurpose.STATIONERY,
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: reservation.payment.id }, data: { status: PaymentStatus.PROCESSING, provider: this.moolre.provider, providerReference: providerResult.providerReference } });
        await tx.paymentProviderAttempt.update({ where: { id: reservation.attemptId }, data: { status: PaymentStatus.PROCESSING, providerReference: providerResult.providerReference, responsePayload: response, resolvedAt: providerResult.requiresOtp ? null : new Date() } });
        await tx.idempotencyKey.update({ where: { userId_key_operation: { userId: actorUserId, key: normalizedKey, operation: 'stationery.payment' } }, data: { responseJson: response, statusCode: 202, completedAt: new Date() } });
      });
      return response;
    } catch {
      throw new ServiceUnavailableException('Stationery payment provider accepted the request, but local state could not be persisted. Reconcile before retrying.');
    }
  }
  private assertManager(roles: RoleName[]) { if (!roles.some((role) => PRIVILEGED_ROLES.has(role))) throw new ForbiddenException('Stationery management access is restricted.'); }
}
