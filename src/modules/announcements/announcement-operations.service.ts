import { Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const MANAGER_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);

@Injectable()
export class AnnouncementOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async previewAudience(audienceType: string, audienceRef?: string | null) {
    const userIds = await this.resolveRecipientIds(audienceType, audienceRef ?? null);
    if (userIds.length === 0) {
      return { audienceType, audienceRef: audienceRef ?? null, recipientCount: 0, smsEligibleCount: 0, pushEligibleCount: 0 };
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, guardian: { select: { preferredSms: true, preferredPush: true } } },
    });

    return {
      audienceType,
      audienceRef: audienceRef ?? null,
      recipientCount: userIds.length,
      smsEligibleCount: users.filter((user) => user.guardian?.preferredSms).length,
      pushEligibleCount: users.filter((user) => user.guardian?.preferredPush).length,
    };
  }

  async getDeliveryReport(announcementId: string) {
    const announcement = await this.prisma.announcement.findUnique({ where: { id: announcementId }, select: { id: true, title: true, publishedAt: true } });
    if (!announcement) throw new NotFoundException('Announcement not found.');

    const grouped = await this.prisma.notificationDelivery.groupBy({
      by: ['channel', 'status'],
      where: { announcementId },
      _count: { _all: true },
    });

    return {
      announcement,
      deliveries: grouped.map((row) => ({ channel: row.channel, status: row.status, count: row._count._all })),
    };
  }

  async getManagerSummary(roles: RoleName[]) {
    if (!roles.some((role) => MANAGER_ROLES.has(role))) {
      return { authorized: false };
    }

    const [drafts, published, pending, failed] = await this.prisma.$transaction([
      this.prisma.announcement.count({ where: { publishedAt: null } }),
      this.prisma.announcement.count({ where: { publishedAt: { not: null } } }),
      this.prisma.notificationDelivery.count({ where: { status: 'pending' } }),
      this.prisma.notificationDelivery.count({ where: { status: 'failed' } }),
    ]);

    return { authorized: true, drafts, published, pendingDeliveries: pending, failedDeliveries: failed };
  }

  private async resolveRecipientIds(audienceType: string, audienceRef: string | null): Promise<string[]> {
    if (audienceType === 'USER') {
      if (!audienceRef) return [];
      const user = await this.prisma.user.findUnique({ where: { id: audienceRef }, select: { id: true, status: true } });
      return user?.status === 'ACTIVE' ? [user.id] : [];
    }

    const roleFilter = audienceType === 'GUARDIANS'
      ? [RoleName.GUARDIAN]
      : audienceType === 'TEACHERS'
        ? [RoleName.TEACHER]
        : audienceType === 'STAFF'
          ? [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT, RoleName.TEACHER, RoleName.SUPPORT_STAFF]
          : null;

    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', ...(roleFilter ? { roles: { some: { role: { in: roleFilter } } } } : {}) },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }
}
