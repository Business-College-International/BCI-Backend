import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

export type AuditListInput = {
  actorUserId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(input: AuditListInput) {
    const requestedPage = input.page ?? 1;
    const requestedPageSize = input.pageSize ?? 50;
    if (!Number.isInteger(requestedPage) || requestedPage < 1) throw new BadRequestException('page must be a positive integer.');
    if (!Number.isInteger(requestedPageSize) || requestedPageSize < 1) throw new BadRequestException('pageSize must be a positive integer.');

    const page = requestedPage;
    const pageSize = Math.min(100, requestedPageSize);
    const createdAt: Prisma.DateTimeFilter = {};

    if (input.from) {
      const from = new Date(input.from);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('from must be a valid date.');
      createdAt.gte = from;
    }
    if (input.to) {
      const to = new Date(input.to);
      if (Number.isNaN(to.getTime())) throw new BadRequestException('to must be a valid date.');
      createdAt.lte = to;
    }

    const where: Prisma.AuditLogWhereInput = {
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          actorUserId: true,
          action: true,
          entityType: true,
          entityId: true,
          beforeJson: true,
          afterJson: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
