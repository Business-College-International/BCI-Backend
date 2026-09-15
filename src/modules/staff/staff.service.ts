import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateStaffDutyDto } from './dto/create-staff-duty.dto';
import { CreateTeacherAssignmentDto } from './dto/create-teacher-assignment.dto';
import { ListTeacherAssignmentsDto } from './dto/list-teacher-assignments.dto';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async listDirectory(actorUserId: string, roles: RoleName[]) {
    await this.assertStaffReadAccess(actorUserId, roles);
    return this.prisma.staff.findMany({
      orderBy: { staffIdNo: 'asc' },
      include: {
        person: {
          select: {
            firstName: true,
            middleName: true,
            lastName: true,
            phone: true,
            email: true,
            photoUrl: true,
          },
        },
        user: { select: { status: true, roles: { select: { role: true } } } },
        duties: { where: { active: true }, orderBy: { startsAt: 'asc' } },
      },
    });
  }

  async getMyProfile(userId: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { userId },
      include: {
        person: { select: { id: true, firstName: true, middleName: true, lastName: true, phone: true, email: true, photoUrl: true } },
        duties: { where: { active: true }, orderBy: { startsAt: 'asc' } },
        teaching: {
          include: {
            class: { select: { id: true, name: true, level: true, programme: true, academicYearId: true } },
            subject: { select: { id: true, code: true, name: true } },
            term: { select: { id: true, code: true, name: true, startsAt: true, endsAt: true, status: true } },
          },
          orderBy: { term: { startsAt: 'desc' } },
        },
      },
    });
    if (!staff) throw new NotFoundException('Staff profile not found for this account.');
    return staff;
  }

  async createDuty(staffPersonId: string, dto: CreateStaffDutyDto, actorUserId: string) {
    const staff = await this.prisma.staff.findUnique({ where: { personId: staffPersonId }, select: { personId: true } });
    if (!staff) throw new NotFoundException('Staff member not found.');

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : undefined;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : undefined;
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException('Duty end must be after its start.');
    }

    return this.prisma.$transaction(async (tx) => {
      const duty = await tx.staffDuty.create({
        data: {
          staffId: staffPersonId,
          description: dto.description.trim(),
          startsAt,
          endsAt,
          assignedByUserId: actorUserId,
          active: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'StaffDuty',
          entityId: duty.id,
          afterJson: { staffId: staffPersonId, description: duty.description },
        },
      });
      return duty;
    });
  }

  async createTeacherAssignment(staffPersonId: string, dto: CreateTeacherAssignmentDto, actorUserId: string) {
    const [staff, term, schoolClass, subject] = await Promise.all([
      this.prisma.staff.findUnique({ where: { personId: staffPersonId }, select: { personId: true } }),
      this.prisma.term.findUnique({ where: { id: dto.termId } }),
      this.prisma.schoolClass.findUnique({ where: { id: dto.classId } }),
      this.prisma.subject.findUnique({ where: { id: dto.subjectId } }),
    ]);

    if (!staff) throw new NotFoundException('Staff member not found.');
    if (!term || !schoolClass || !subject) throw new NotFoundException('Term, class, or subject not found.');
    if (schoolClass.academicYearId !== term.academicYearId) {
      throw new BadRequestException('The class does not belong to the selected term academic year.');
    }
    if (subject.level !== schoolClass.level) {
      throw new BadRequestException('The subject level does not match the class level.');
    }
    if (subject.level.toString().startsWith('SHS') && subject.programme !== 'NONE' && subject.programme !== schoolClass.programme) {
      throw new BadRequestException('The subject programme does not match the class programme.');
    }
    if (term.status === 'CLOSED') throw new BadRequestException('Teacher assignments cannot be created for a closed term.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const assignment = await tx.teacherAssignment.create({
          data: {
            staffId: staffPersonId,
            classId: dto.classId,
            subjectId: dto.subjectId,
            termId: dto.termId,
          },
          include: {
            class: { select: { name: true, level: true, programme: true } },
            subject: { select: { code: true, name: true } },
            term: { select: { code: true, name: true } },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'TeacherAssignment',
            entityId: assignment.id,
            afterJson: { staffId: staffPersonId, classId: dto.classId, subjectId: dto.subjectId, termId: dto.termId },
          },
        });
        return assignment;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('This teacher assignment already exists.');
      }
      throw error;
    }
  }

  async listTeacherAssignmentsForStaff(staffPersonId: string, filters: ListTeacherAssignmentsDto = {}) {
    const staff = await this.prisma.staff.findUnique({ where: { personId: staffPersonId }, select: { personId: true } });
    if (!staff) throw new NotFoundException('Staff member not found.');

    return this.prisma.teacherAssignment.findMany({
      where: {
        staffId: staffPersonId,
        ...(filters.termId ? { termId: filters.termId } : {}),
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      },
      include: {
        class: { select: { id: true, name: true, level: true, programme: true, room: true } },
        subject: { select: { id: true, code: true, name: true } },
        term: { select: { id: true, code: true, name: true, startsAt: true, endsAt: true, status: true } },
      },
      orderBy: [{ term: { startsAt: 'desc' } }, { class: { name: 'asc' } }],
    });
  }

  async listAllTeacherAssignments(filters: ListTeacherAssignmentsDto = {}) {
    return this.prisma.teacherAssignment.findMany({
      where: {
        ...(filters.termId ? { termId: filters.termId } : {}),
        ...(filters.classId ? { classId: filters.classId } : {}),
        ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      },
      include: {
        staff: { include: { person: { select: { firstName: true, lastName: true, phone: true, email: true } } } },
        class: { select: { id: true, name: true, level: true, programme: true, room: true } },
        subject: { select: { id: true, code: true, name: true } },
        term: { select: { id: true, code: true, name: true, startsAt: true, endsAt: true, status: true } },
      },
      orderBy: [{ term: { startsAt: 'desc' } }, { class: { name: 'asc' } }],
    });
  }

  async removeTeacherAssignment(assignmentId: string, actorUserId: string) {
    const assignment = await this.prisma.teacherAssignment.findUnique({
      where: { id: assignmentId },
      include: { term: { select: { status: true } }, staff: { select: { personId: true } } },
    });
    if (!assignment) throw new NotFoundException('Teacher assignment not found.');
    if (assignment.term.status === 'CLOSED') throw new BadRequestException('Teacher assignments cannot be changed for a closed term.');

    return this.prisma.$transaction(async (tx) => {
      await tx.teacherAssignment.delete({ where: { id: assignmentId } });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'DELETE',
          entityType: 'TeacherAssignment',
          entityId: assignmentId,
          beforeJson: { staffId: assignment.staff.personId },
        },
      });
      return { success: true };
    });
  }

  async assertStaffReadAccess(userId: string, roles: RoleName[], targetStaffPersonId?: string) {
    if (roles.includes(RoleName.DIRECTOR) || roles.includes(RoleName.PRINCIPAL) || roles.includes(RoleName.OFFICE) || roles.includes(RoleName.ACCOUNTANT)) return;
    if (roles.includes(RoleName.TEACHER) || roles.includes(RoleName.SUPPORT_STAFF)) {
      const own = await this.prisma.staff.findUnique({ where: { userId }, select: { personId: true } });
      if (own && (!targetStaffPersonId || own.personId === targetStaffPersonId)) return;
    }
    throw new ForbiddenException('You do not have access to this staff record.');
  }
}
