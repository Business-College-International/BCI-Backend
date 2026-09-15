import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName, TermStatus } from '@prisma/client';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { CreateClassDto } from './dto/create-class.dto';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { PrismaService } from '../../prisma.service';

const PRIVILEGED_ACADEMIC_READ_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
  RoleName.ACCOUNTANT,
]);

@Injectable()
export class AcademicsService {
  constructor(private readonly prisma: PrismaService) {}

  listAcademicYears() {
    return this.prisma.academicYear.findMany({ orderBy: { startsAt: 'desc' }, include: { terms: { orderBy: { startsAt: 'asc' } } } });
  }

  async createAcademicYear(dto: CreateAcademicYearDto, actorUserId: string) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('Academic year end must be after its start.');

    return this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) await tx.academicYear.updateMany({ data: { isCurrent: false } });
      const year = await tx.academicYear.create({
        data: { name: dto.name.trim(), startsAt, endsAt, isCurrent: dto.isCurrent ?? false },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'AcademicYear',
          entityId: year.id,
          afterJson: { name: year.name, isCurrent: year.isCurrent },
        },
      });
      return year;
    });
  }

  async setCurrentAcademicYear(id: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id } });
      if (!year) throw new NotFoundException('Academic year not found.');
      await tx.academicYear.updateMany({ data: { isCurrent: false } });
      const updated = await tx.academicYear.update({ where: { id }, data: { isCurrent: true } });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'AcademicYear',
          entityId: id,
          beforeJson: { isCurrent: year.isCurrent },
          afterJson: { isCurrent: true },
        },
      });
      return updated;
    });
  }

  async createTerm(academicYearId: string, dto: CreateTermDto, actorUserId: string) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) throw new BadRequestException('Term end must be after its start.');

    return this.prisma.$transaction(async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id: academicYearId } });
      if (!year) throw new NotFoundException('Academic year not found.');
      if (startsAt < year.startsAt || endsAt > year.endsAt) {
        throw new BadRequestException('Term dates must fall within the academic year.');
      }
      if (dto.status === 'OPEN') {
        await tx.term.updateMany({ where: { academicYearId }, data: { status: TermStatus.CLOSED } });
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
            afterJson: { academicYearId, code: term.code, status: term.status },
          },
        });
        return term;
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A term with that code already exists for this academic year.');
        throw error;
      }
    });
  }

  async transitionTerm(id: string, status: TermStatus, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const term = await tx.term.findUnique({ where: { id }, include: { academicYear: true } });
      if (!term) throw new NotFoundException('Term not found.');

      const allowed = term.status === TermStatus.DRAFT && status === TermStatus.OPEN
        ? true
        : term.status === TermStatus.OPEN && status === TermStatus.CLOSED;
      if (!allowed) {
        throw new ConflictException(`Invalid term transition from ${term.status} to ${status}.`);
      }

      if (status === TermStatus.OPEN) {
        await tx.term.updateMany({ where: { academicYearId: term.academicYearId }, data: { status: TermStatus.CLOSED } });
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

  async listClasses(academicYearId: string | undefined, userId: string, roles: RoleName[]) {
    const isPrivileged = roles.some((role) => PRIVILEGED_ACADEMIC_READ_ROLES.has(role));
    let classIds: string[] | undefined;

    if (!isPrivileged && roles.includes(RoleName.TEACHER)) {
      const staff = await this.prisma.staff.findUnique({ where: { userId }, select: { personId: true } });
      if (!staff) throw new ForbiddenException('Teacher access requires an active staff link.');

      const assignments = await this.prisma.teacherAssignment.findMany({
        where: academicYearId
          ? { staffId: staff.personId, class: { academicYearId } }
          : { staffId: staff.personId },
        select: { classId: true },
        distinct: ['classId'],
      });
      classIds = assignments.map((assignment) => assignment.classId);
    } else if (!isPrivileged) {
      return [];
    }

    return this.prisma.schoolClass.findMany({
      where: {
        ...(academicYearId ? { academicYearId } : {}),
        ...(classIds ? { id: { in: classIds } } : {}),
      },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });
  }

  async createClass(dto: CreateClassDto, actorUserId: string) {
    const year = await this.prisma.academicYear.findUnique({ where: { id: dto.academicYearId } });
    if (!year) throw new NotFoundException('Academic year not found.');
    if (dto.capacity !== undefined && dto.capacity < 1) throw new BadRequestException('Class capacity must be at least 1.');
    if (dto.level.startsWith('SHS') && dto.programme === 'NONE') {
      throw new BadRequestException('SHS classes must have a programme.');
    }
    if (!dto.level.startsWith('SHS') && dto.programme !== 'NONE') {
      throw new BadRequestException('Non-SHS classes cannot use an SHS programme.');
    }

    try {
      const schoolClass = await this.prisma.$transaction(async (tx) => {
        const created = await tx.schoolClass.create({
          data: {
            academicYearId: dto.academicYearId,
            name: dto.name.trim(),
            level: dto.level,
            programme: dto.programme,
            division: dto.division?.trim(),
            room: dto.room?.trim(),
            capacity: dto.capacity,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'SchoolClass',
            entityId: created.id,
            afterJson: { academicYearId: created.academicYearId, name: created.name, level: created.level, programme: created.programme },
          },
        });
        return created;
      });
      return schoolClass;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A class with that name already exists for this academic year.');
      throw error;
    }
  }

  async updateClass(id: string, dto: UpdateClassDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.schoolClass.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Class not found.');

      if (dto.capacity !== undefined) {
        const activeCount = await tx.enrolment.count({ where: { classId: id, status: 'ACTIVE' } });
        if (dto.capacity < activeCount) throw new ConflictException(`Capacity cannot be reduced below the ${activeCount} active enrolments currently assigned to this class.`);
      }

      const updated = await tx.schoolClass.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          division: dto.division?.trim(),
          room: dto.room?.trim(),
          capacity: dto.capacity,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'SchoolClass',
          entityId: id,
          beforeJson: { name: current.name, division: current.division, room: current.room, capacity: current.capacity },
          afterJson: { name: updated.name, division: updated.division, room: updated.room, capacity: updated.capacity },
        },
      });

      return updated;
    });
  }
}
