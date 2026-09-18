import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const MANAGER_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);

@Injectable()
export class NotificationOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listQueue(roles: RoleName[]) {
    this.assertManager(roles);
    const rows = await this.prisma.notificationDelivery.findMany({
      where: { status: { in: ['pending', 'failed'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        channel: true,
        provider: true,
        status: true,
        sentAt: true,
        deliveredAt: true,
        failureCode: true,
        createdAt: true,
        recipientUserId: true,
        announcement: { select: { id: true, title: true, audienceType: true, publishedAt: true } },
      },
    });
    return rows;
  }

  async requeue(id: string, actorUserId: string, roles: RoleName[]) {
    this.assertManager(roles);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "NotificationDelivery" WHERE id = ${id} FOR UPDATE`;
      const delivery = await tx.notificationDelivery.findUnique({ where: { id }, select: { id: true, status: true, channel: true, provider: true } });
      if (!delivery) throw new NotFoundException('Notification delivery not found.');
      if (delivery.status !== 'failed') throw new ForbiddenException('Only failed deliveries can be requeued.');

      const updated = await tx.notificationDelivery.update({ where: { id }, data: { status: 'pending', failureCode: null }, select: { id: true, status: true, channel: true, provider: true } });
      await tx.auditLog.create({ data: { actorUserId, action: 'UPDATE', entityType: 'NotificationDelivery', entityId: id, beforeJson: delivery, afterJson: updated } });
      return updated;
    });
  }

  private assertManager(roles: RoleName[]) {
    if (!roles.some((role) => MANAGER_ROLES.has(role))) throw new ForbiddenException('Notification operations access is restricted.');
  }
}
