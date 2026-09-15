import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const PRIVILEGED_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
  RoleName.ACCOUNTANT,
]);

@Injectable()
export class ClassRosterService {
  constructor(private readonly prisma: PrismaService) {}

  async getRoster(classId: string, termId: string, userId: string, roles: RoleName[]) {
    const schoolClass = await this.prisma.schoolClass.findUnique({
      where: { id: classId },
      include: { academicYear: true },
    });
    if (!schoolClass) throw new NotFoundException('Class not found.');

    const term = await this.prisma.term.findUnique({ where: { id: termId } });
    if (!term) throw new NotFoundException('Term not found.');
    if (term.academicYearId !== schoolClass.academicYearId) throw new ForbiddenException('Class and term belong to different academic years.');

    if (!roles.some((role) => PRIVILEGED_ROLES.has(role))) {
      if (!roles.includes(RoleName.TEACHER)) throw new ForbiddenException('Class roster access is restricted to school staff.');
      const staff = await this.prisma.staff.findUnique({ where: { userId }, select: { personId: true } });
      if (!staff) throw new ForbiddenException('Teacher access requires an active staff link.');
      const assignment = await this.prisma.teacherAssignment.findFirst({
        where: { staffId: staff.personId, classId, termId },
        select: { id: true },
      });
      if (!assignment) throw new ForbiddenException('You are not assigned to this class for the selected term.');
    }

    const enrolments = await this.prisma.enrolment.findMany({
      where: { classId, termId, status: 'ACTIVE' },
      include: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            sex: true,
            passportPhotoUrl: true,
            status: true,
            guardians: {
              where: { isPrimaryContact: true },
              take: 1,
              include: { guardian: { include: { person: { select: { firstName: true, lastName: true, phone: true } } } } },
            },
          },
        },
      },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });

    return {
      class: { id: schoolClass.id, name: schoolClass.name, level: schoolClass.level, programme: schoolClass.programme, division: schoolClass.division, room: schoolClass.room, capacity: schoolClass.capacity },
      term: { id: term.id, code: term.code, name: term.name, startsAt: term.startsAt, endsAt: term.endsAt, status: term.status },
      count: enrolments.length,
      students: enrolments.map((enrolment) => {
        const guardian = enrolment.student.guardians[0]?.guardian.person;
        return {
          enrolmentId: enrolment.id,
          student: enrolment.student,
          primaryGuardian: guardian ? { name: `${guardian.firstName} ${guardian.lastName}`, phone: guardian.phone } : null,
        };
      }),
    };
  }
}
