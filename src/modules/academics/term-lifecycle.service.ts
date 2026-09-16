import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateTermDto } from './dto/create-term.dto';
import { TermStatus } from '@prisma/client';

@Injectable()
export class TermLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async createTerm(academicYearId: string, dto: CreateTermDto, actorUserId: string) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('Term end must be after term start.');

    return this.prisma.$transaction(async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id: academicYearId } });
      if (!year) throw new NotFoundException('Academic year not found.');
      if (startsAt < year.startsAt || endsAt > year.endsAt) {
        throw new BadRequestException('Term dates must fall within the academic year.');
      }

      const overlap = await tx.term.findFirst({
        where: {
          academicYearId,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { id: true, code: true },
      });
      if (overlap) throw new ConflictException(`Term dates overlap existing term ${overlap.code}.`);

      if (dto.status === TermStatus.OPEN) {
        await tx.term.updateMany({ where: { academicYearId, status: TermStatus.OPEN }, data: { status: TermStatus.CLOSED } });
      }

      try {
        const term = await tx.term.create({
          data: { academicYearId, code: dto.code.trim(), name: dto.name.trim(), startsAt, endsAt, status: dto.status },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'Term',
            entityId: term.id,
            afterJson: { academicYearId, code: term.code, status: term.status, startsAt: term.startsAt.toISOString(), endsAt: term.endsAt.toISOString() },
          },
        });
        return term;
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') {
          throw new ConflictException('A term with that code already exists for this academic year.');
        }
        throw error;
      }
    });
  }

  async transitionTerm(id: string, status: TermStatus, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const term = await tx.term.findUnique({ where: { id } });
      if (!term) throw new NotFoundException('Term not found.');

      const allowed = (term.status === TermStatus.DRAFT && status === TermStatus.OPEN)
        || (term.status === TermStatus.OPEN && status === TermStatus.CLOSED);
      if (!allowed) throw new ConflictException(`Invalid term transition from ${term.status} to ${status}.`);

      if (status === TermStatus.OPEN) {
        await tx.term.updateMany({ where: { academicYearId: term.academicYearId, status: TermStatus.OPEN }, data: { status: TermStatus.CLOSED } });
      }

      const updated = await tx.term.update({ where: { id }, data: { status } });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'Term',
          entityId: id,
          beforeJson: { status: term.status },
          afterJson: { status },
        },
      });
      return updated;
    });
  }
}
