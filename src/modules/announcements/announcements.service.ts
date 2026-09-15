import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

const MANAGE_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAnnouncementDto, actorUserId: string, roles: RoleName[]) {
    this.assertManager(roles);
    if (dto.audienceType === 'USER' && !dto.audienceRef) {
      throw new BadRequestException('A USER announcement requires audienceRef to identify the recipient user.');
    }
    if (dto.audienceType !== 'USER' && dto.audienceRef) {
      throw new BadRequestException('audienceRef is only valid for USER announcements.');
    }

    return this.prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.create({
        data: {
          title: dto.title.trim(),
          body: dto.body.trim(),
          audienceType: dto.audienceType,
          audienceRef: dto.audienceRef?.trim(),
          sentBy: actorUserId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'Announcement',
          entityId: announcement.id,
          afterJson: { title: announcement.title, audienceType: announcement.audienceType, audienceRef: announcement.audienceRef },
        },
      });
      return announcement;
    });
  }

  async publish(id: string, actorUserId: string, roles: RoleName[]) {
    this.assertManager(roles);
    return this.prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.findUnique({ where: { id } });
      if (!announcement) throw new NotFoundException('Announcement not found.');
      if (announcement.publishedAt) throw new BadRequestException('Announcement is already published.');

      const recipientIds = await this.resolveRecipients(tx, announcement.audienceType, announcement.audienceRef);
      const publishedAt = new Date();
      await tx.announcement.update({ where: { id }, data: { publishedAt } });
      if (recipientIds.length > 0) {
        await tx.notificationDelivery.createMany({
          data: recipientIds.map((recipientUserId) => ({
            announcementId: id,
            recipientUserId,
            channel: 'IN_APP',
            provider: 'internal',
            status: 'delivered',
            sentAt: publishedAt,
            deliveredAt: publishedAt,
          })),
          skipDuplicates: true,
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'Announcement',
          entityId: id,
          afterJson: { publishedAt: publishedAt.toISOString(), recipientCount: recipientIds.length },
        },
      });

      return { ...announcement, publishedAt, recipientCount: recipientIds.length };
    });
  }

  async listForUser(userId: string, roles: RoleName[]) {
    const isGuardian = roles.includes(RoleName.GUARDIAN);
    const isTeacher = roles.includes(RoleName.TEACHER);
    const isStaff = roles.some((role) => [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT, RoleName.SUPPORT_STAFF, RoleName.TEACHER].includes(role));

    const audienceTypes = ['ALL'] as string[];
    if (isGuardian) audienceTypes.push('GUARDIANS');
    if (isStaff) audienceTypes.push('STAFF');
    if (isTeacher) audienceTypes.push('TEACHERS');

    const [global, direct] = await Promise.all([
      this.prisma.announcement.findMany({
        where: { publishedAt: { not: null }, audienceType: { in: audienceTypes } },
        orderBy: { publishedAt: 'desc' },
        take: 100,
      }),
      this.prisma.announcement.findMany({
        where: { publishedAt: { not: null }, audienceType: 'USER', audienceRef: userId },
        orderBy: { publishedAt: 'desc' },
        take: 100,
      }),
    ]);

    return [...global, ...direct]
      .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
      .slice(0, 100);
  }

  private assertManager(roles: RoleName[]) {
    if (!roles.some((role) => MANAGE_ROLES.has(role))) {
      throw new ForbiddenException('Announcement management access is restricted.');
    }
  }

  private async resolveRecipients(tx: PrismaService, audienceType: string, audienceRef: string | null) {
    if (audienceType === 'USER') {
      if (!audienceRef) throw new BadRequestException('USER announcements require a recipient user.');
      const user = await tx.user.findUnique({ where: { id: audienceRef }, select: { id: true } });
      if (!user) throw new NotFoundException('Announcement recipient user not found.');
      return [user.id];
    }

    if (audienceType === 'GUARDIANS') {
      const users = await tx.user.findMany({ where: { roles: { some: { role: RoleName.GUARDIAN } }, status: 'ACTIVE' }, select: { id: true } });
      return users.map((user) => user.id);
    }

    if (audienceType === 'TEACHERS') {
      const users = await tx.user.findMany({ where: { roles: { some: { role: RoleName.TEACHER } }, status: 'ACTIVE' }, select: { id: true } });
      return users.map((user) => user.id);
    }

    if (audienceType === 'STAFF') {
      const users = await tx.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { in: [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT, RoleName.TEACHER, RoleName.SUPPORT_STAFF] } } } }, select: { id: true } });
      return users.map((user) => user.id);
    }

    const users = await tx.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    return users.map((user) => user.id);
  }
}
