import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { CreateClassDto } from './dto/create-class.dto';
import { CreateTermDto } from './dto/create-term.dto';
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
    return this.prisma.academicYear.findMany({ orderBy: { startsAt: 'desc' }, include: { terms: true } });
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
        await tx.term.updateMany({ where: { academicYearId }, data: { status: 'CLOSED' } });
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
}
