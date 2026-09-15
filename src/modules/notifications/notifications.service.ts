import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ListNotificationsDto } from './notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(userId: string, dto: ListNotificationsDto) {
    const status = dto.status?.trim();
    if (status && !['pending', 'delivered', 'read', 'failed'].includes(status)) {
      throw new ForbiddenException('Unsupported notification status.');
    }

    return this.prisma.notificationDelivery.findMany({
      where: { recipientUserId: userId, ...(status ? { status } : {}) },
      include: { announcement: { select: { id: true, title: true, body: true, audienceType: true, publishedAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(id: string, userId: string) {
    const notification = await this.prisma.notificationDelivery.findFirst({
      where: { id, recipientUserId: userId },
      select: { id: true, status: true },
    });
    if (!notification) throw new NotFoundException('Notification not found.');

    return this.prisma.notificationDelivery.update({
      where: { id: notification.id },
      data: { status: 'read' },
      select: { id: true, status: true, deliveredAt: true, sentAt: true },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: { recipientUserId: userId, status: { in: ['pending', 'delivered'] } },
      data: { status: 'read' },
    });
    return { updatedCount: result.count };
  }
}
