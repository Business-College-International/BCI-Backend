import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Level, Programme, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateFeeScheduleDto } from './dto/create-fee-schedule.dto';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateFeeScheduleDto } from './dto/update-fee-schedule.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

const ACADEMIC_MANAGERS = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);
const FINANCE_MANAGERS = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.ACCOUNTANT]);

@Injectable()
export class ConfigurationService {
  constructor(private readonly prisma: PrismaService) {}

  listSubjects(filters?: { level?: Level; programme?: Programme; isElective?: boolean; isActive?: boolean }) {
    return this.prisma.subject.findMany({ where: filters, orderBy: [{ level: 'asc' }, { programme: 'asc' }, { code: 'asc' }] });
  }

  async createSubject(dto: CreateSubjectDto, actorUserId: string, roles: RoleName[]) {
    this.assertRole(roles, ACADEMIC_MANAGERS, 'Subject management is restricted to school academic managers.');
    if (!dto.isElective && dto.programme !== Programme.NONE) throw new ConflictException('A subject tied to a programme should be marked elective.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.subject.create({ data: { code: dto.code.trim().toUpperCase(), name: dto.name.trim(), level: dto.level, isElective: dto.isElective ?? false, programme: dto.programme } });
        await tx.auditLog.create({ data: { actorUserId, action: 'CREATE', entityType: 'Subject', entityId: created.id, afterJson: { code: created.code, level: created.level, programme: created.programme, isElective: created.isElective } } });
        return created;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A subject with that code already exists.');
      throw error;
    }
  }

  async updateSubject(id: string, dto: UpdateSubjectDto, actorUserId: string, roles: RoleName[]) {
    this.assertRole(roles, ACADEMIC_MANAGERS, 'Subject management is restricted to school academic managers.');
    const before = await this.prisma.subject.findUnique({ where: { id }, include: { assignments: { select: { id: true }, take: 1 } } });
    if (!before) throw new NotFoundException('Subject not found.');
    const nextProgramme = dto.programme ?? before.programme;
    const nextElective = dto.isElective ?? before.isElective;
    if (!nextElective && nextProgramme !== Programme.NONE) throw new ConflictException('A subject tied to a programme should be marked elective.');
    if (dto.level && dto.level !== before.level && before.assignments.length > 0) throw new ConflictException('A subject already used in teaching assignments cannot change level.');
    return this.prisma.$transaction(async (tx) => {
      const subject = await tx.subject.update({ where: { id }, data: { name: dto.name?.trim(), level: dto.level, isElective: dto.isElective, programme: dto.programme, isActive: dto.isActive } });
      await tx.auditLog.create({ data: { actorUserId, action: 'UPDATE', entityType: 'Subject', entityId: id, beforeJson: { name: before.name, level: before.level, programme: before.programme, isElective: before.isElective, isActive: before.isActive }, afterJson: { name: subject.name, level: subject.level, programme: subject.programme, isElective: subject.isElective, isActive: subject.isActive } } });
      return subject;
    });
  }

  async listFeeSchedules(termId: string, roles: RoleName[]) {
    if (!roles.some((role) => FINANCE_MANAGERS.has(role) || ACADEMIC_MANAGERS.has(role))) throw new ForbiddenException('Fee schedule access is restricted.');
    const term = await this.prisma.term.findUnique({ where: { id: termId }, select: { id: true, academicYearId: true, code: true, name: true, status: true } });
    if (!term) throw new NotFoundException('Term not found.');
    return {
      term,
      schedules: await this.prisma.feeSchedule.findMany({ where: { termId }, orderBy: [{ level: 'asc' }, { programme: 'asc' }, { itemCode: 'asc' }] }),
    };
  }

  async createFeeSchedule(dto: CreateFeeScheduleDto, actorUserId: string, roles: RoleName[]) {
    this.assertRole(roles, FINANCE_MANAGERS, 'Fee schedule management is restricted to finance managers.');
    const term = await this.prisma.term.findUnique({ where: { id: dto.termId } });
    if (!term) throw new NotFoundException('Term not found.');
    if (dto.amount < 0) throw new ConflictException('Fee amount cannot be negative.');
    if (term.status === 'CLOSED') throw new ConflictException('Closed terms cannot receive new fee schedule items.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const schedule = await tx.feeSchedule.create({ data: { termId: dto.termId, level: dto.level, programme: dto.programme, itemCode: dto.itemCode.trim().toUpperCase(), itemName: dto.itemName.trim(), amount: new Prisma.Decimal(dto.amount), isOptional: dto.isOptional ?? false } });
        await tx.auditLog.create({ data: { actorUserId, action: 'CREATE', entityType: 'FeeSchedule', entityId: schedule.id, afterJson: { termId: dto.termId, level: dto.level, programme: dto.programme, itemCode: schedule.itemCode, amount: schedule.amount.toString(), isOptional: schedule.isOptional, isActive: schedule.isActive } } });
        return schedule;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('That fee item already exists for this term, level and programme.');
      throw error;
    }
  }

  async updateFeeSchedule(id: string, dto: UpdateFeeScheduleDto, actorUserId: string, roles: RoleName[]) {
    this.assertRole(roles, FINANCE_MANAGERS, 'Fee schedule management is restricted to finance managers.');
    const before = await this.prisma.feeSchedule.findUnique({ where: { id }, include: { charges: { select: { id: true }, take: 1 } } });
    if (!before) throw new NotFoundException('Fee schedule item not found.');
    if (dto.amount !== undefined && dto.amount < 0) throw new ConflictException('Fee amount cannot be negative.');
    if (dto.amount !== undefined && new Prisma.Decimal(dto.amount).equals(before.amount) === false && before.charges.length > 0) {
      throw new ConflictException('A fee amount cannot change after it has been used on an invoice line. Create a replacement fee item instead.');
    }
    if (before.termId && dto.isActive === false) {
      const term = await this.prisma.term.findUnique({ where: { id: before.termId }, select: { status: true } });
      if (term?.status === 'CLOSED' && before.isActive === false) throw new ConflictException('Fee schedule item is already inactive.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.feeSchedule.update({
        where: { id },
        data: {
          itemName: dto.itemName?.trim(),
          ...(dto.amount !== undefined ? { amount: new Prisma.Decimal(dto.amount) } : {}),
          isOptional: dto.isOptional,
          isActive: dto.isActive,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'FeeSchedule',
          entityId: id,
          beforeJson: { itemName: before.itemName, amount: before.amount.toString(), isOptional: before.isOptional, isActive: before.isActive },
          afterJson: { itemName: updated.itemName, amount: updated.amount.toString(), isOptional: updated.isOptional, isActive: updated.isActive },
        },
      });
      return updated;
    });
  }

  private assertRole(roles: RoleName[], allowed: Set<RoleName>, message: string) {
    if (!roles.some((role) => allowed.has(role))) throw new ForbiddenException(message);
  }
}
