import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

const MANAGE_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAnnouncementDto, actorUserId: string, roles: RoleName[]) {
    this.assertManager(roles);
    if (dto.audienceType === 'USER' && !dto.audienceRef) throw new BadRequestException('A USER announcement requires audienceRef to identify the recipient user.');
    if (dto.audienceType !== 'USER' && dto.audienceRef) throw new BadRequestException('audienceRef is only valid for USER announcements.');

    return this.prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.create({ data: { title: dto.title.trim(), body: dto.body.trim(), audienceType: dto.audienceType, audienceRef: dto.audienceRef?.trim(), sentBy: actorUserId } });
      await tx.auditLog.create({ data: { actorUserId, action: 'CREATE', entityType: 'Announcement', entityId: announcement.id, afterJson: { title: announcement.title, audienceType: announcement.audienceType, audienceRef: announcement.audienceRef } } });
      return announcement;
    });
  }

  async publish(id: string, actorUserId: string, roles: RoleName[]) {
    this.assertManager(roles);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Announcement" WHERE id = ${id} FOR UPDATE`;
      const announcement = await tx.announcement.findUnique({ where: { id } });
      if (!announcement) throw new NotFoundException('Announcement not found.');
      if (announcement.publishedAt) throw new BadRequestException('Announcement is already published.');
      const recipientIds = await this.resolveRecipients(tx, announcement.audienceType, announcement.audienceRef);
      const publishedAt = new Date();
      await tx.announcement.update({ where: { id }, data: { publishedAt } });
      if (recipientIds.length > 0) await tx.notificationDelivery.createMany({ data: recipientIds.map((recipientUserId) => ({ announcementId: id, recipientUserId, channel: 'IN_APP', provider: 'internal', status: 'delivered', sentAt: publishedAt, deliveredAt: publishedAt })) });
      await tx.auditLog.create({ data: { actorUserId, action: 'UPDATE', entityType: 'Announcement', entityId: id, afterJson: { publishedAt: publishedAt.toISOString(), recipientCount: recipientIds.length } } });
      return { ...announcement, publishedAt, recipientCount: recipientIds.length };
    });
  }

  async listForUser(userId: string, roles: RoleName[]) {
    const isManager = roles.some((role) => MANAGE_ROLES.has(role));
    const audienceTypes = ['ALL'] as string[];
    if (roles.includes(RoleName.GUARDIAN)) audienceTypes.push('GUARDIANS');
    if (roles.includes(RoleName.TEACHER)) audienceTypes.push('TEACHERS');
    if (roles.some((role) => ([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT, RoleName.SUPPORT_STAFF] as RoleName[]).includes(role))) audienceTypes.push('STAFF');

    const [publishedAudience, publishedDirect, ownDrafts] = await Promise.all([
      this.prisma.announcement.findMany({ where: { publishedAt: { not: null }, audienceType: { in: audienceTypes } }, orderBy: { publishedAt: 'desc' }, take: 100 }),
      this.prisma.announcement.findMany({ where: { publishedAt: { not: null }, audienceType: 'USER', audienceRef: userId }, orderBy: { publishedAt: 'desc' }, take: 100 }),
      isManager ? this.prisma.announcement.findMany({ where: { sentBy: userId, publishedAt: null }, orderBy: { createdAt: 'desc' }, take: 100 }) : Promise.resolve([]),
    ]);

    return [...publishedAudience, ...publishedDirect, ...ownDrafts].sort((a, b) => (b.publishedAt?.getTime() ?? b.createdAt.getTime()) - (a.publishedAt?.getTime() ?? a.createdAt.getTime())).slice(0, 100);
  }

  private assertManager(roles: RoleName[]) {
    if (!roles.some((role) => MANAGE_ROLES.has(role))) throw new ForbiddenException('Announcement management access is restricted.');
  }

  private async resolveRecipients(tx: Prisma.TransactionClient, audienceType: string, audienceRef: string | null) {
    if (audienceType === 'USER') {
      if (!audienceRef) throw new BadRequestException('USER announcements require a recipient user.');
      const user = await tx.user.findUnique({ where: { id: audienceRef }, select: { id: true } });
      if (!user) throw new NotFoundException('Announcement recipient user not found.');
      return [user.id];
    }
    if (audienceType === 'GUARDIANS') return (await tx.user.findMany({ where: { roles: { some: { role: RoleName.GUARDIAN } }, status: 'ACTIVE' }, select: { id: true } })).map((user) => user.id);
    if (audienceType === 'TEACHERS') return (await tx.user.findMany({ where: { roles: { some: { role: RoleName.TEACHER } }, status: 'ACTIVE' }, select: { id: true } })).map((user) => user.id);
    if (audienceType === 'STAFF') return (await tx.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { in: [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT, RoleName.TEACHER, RoleName.SUPPORT_STAFF] } } } }, select: { id: true } })).map((user) => user.id);
    return (await tx.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((user) => user.id);
  }
}
