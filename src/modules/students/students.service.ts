import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName, StudentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { LinkGuardianDto } from './dto/link-guardian.dto';
import { ListStudentsDto } from './dto/list-students.dto';
import { WithdrawStudentDto } from './dto/withdraw-student.dto';

const PRIVILEGED_STUDENT_READ_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
  RoleName.ACCOUNTANT,
]);

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listDirectory(userId: string, roles: RoleName[], query: ListStudentsDto) {
    const isPrivilegedStaff = roles.some((role) => PRIVILEGED_STUDENT_READ_ROLES.has(role));
    let classScope: string[] | undefined;

    if (!isPrivilegedStaff) {
      if (!roles.includes(RoleName.TEACHER)) {
        throw new ForbiddenException('Directory access is restricted to authorized school staff.');
      }

      const staff = await this.prisma.staff.findUnique({ where: { userId }, select: { personId: true } });
      if (!staff) throw new ForbiddenException('Teacher access requires an active staff link.');

      const assignments = await this.prisma.teacherAssignment.findMany({
        where: {
          staffId: staff.personId,
          ...(query.termId ? { termId: query.termId } : {}),
        },
        select: { classId: true },
        distinct: ['classId'],
      });
      classScope = assignments.map((assignment) => assignment.classId);
      if (classScope.length === 0) return [];
    }

    const search = query.q?.trim();
    const enrolmentFilter = {
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.classId ? { classId: query.classId } : {}),
      ...(query.level ? { level: query.level } : {}),
      ...(query.programme ? { programme: query.programme } : {}),
      ...(classScope ? { classId: { in: classScope } } : {}),
      ...(query.status ? { status: query.status === StudentStatus.ACTIVE ? 'ACTIVE' : undefined } : {}),
    };

    const students = await this.prisma.student.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { admissionNumber: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(Object.keys(enrolmentFilter).length > 0 ? { enrolments: { some: enrolmentFilter } } : {}),
      },
      include: {
        guardians: {
          where: { isPrimaryContact: true },
          take: 1,
          include: {
            guardian: {
              include: {
                person: { select: { firstName: true, lastName: true, phone: true, email: true } },
              },
            },
          },
        },
        enrolments: {
          where: { ...(Object.keys(enrolmentFilter).length > 0 ? enrolmentFilter : {}) },
          orderBy: { enrolledAt: 'desc' },
          take: 1,
          include: { academicYear: true, term: true, class: true },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 500,
    });

    return students.map((student) => {
      const primaryGuardian = student.guardians[0]?.guardian;
      const enrolment = student.enrolments[0];
      return {
        id: student.id,
        admissionNumber: student.admissionNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        dateOfBirth: student.dateOfBirth,
        status: student.status,
        passportPhotoUrl: student.passportPhotoUrl,
        primaryGuardian: primaryGuardian
          ? {
              name: `${primaryGuardian.person.firstName} ${primaryGuardian.person.lastName}`,
              phone: primaryGuardian.person.phone,
              email: primaryGuardian.person.email,
            }
          : null,
        enrolment: enrolment
          ? {
              academicYear: enrolment.academicYear.name,
              term: enrolment.term.name,
              class: enrolment.class.name,
              level: enrolment.level,
              programme: enrolment.programme,
              status: enrolment.status,
            }
          : null,
      };
    });
  }

  async listMyWards(userId: string) {
    const guardian = await this.prisma.guardian.findUnique({
      where: { userId },
      include: {
        wards: {
          include: {
            student: {
              include: {
                enrolments: {
                  where: { status: 'ACTIVE' },
                  orderBy: { enrolledAt: 'desc' },
                  take: 1,
                  include: { academicYear: true, term: true, class: true },
                },
              },
            },
          },
          orderBy: { isPrimaryContact: 'desc' },
        },
      },
    });

    if (!guardian) throw new NotFoundException('Guardian profile not found.');

    return guardian.wards.map(({ student, relationship, isPrimaryContact, canViewAcademic, canPayFees, canManageWallet }) => ({
      student: canViewAcademic
        ? this.toStudentView(student)
        : {
            id: student.id,
            admissionNumber: student.admissionNumber,
            firstName: student.firstName,
            lastName: student.lastName,
            dateOfBirth: student.dateOfBirth,
            sex: student.sex,
            hometown: student.hometown,
            region: student.region,
            passportPhotoUrl: student.passportPhotoUrl,
            previousSchool: student.previousSchool,
            status: student.status,
            admittedAt: student.admittedAt,
          },
      relationship,
      isPrimaryContact,
      permissions: { canViewAcademic, canPayFees, canManageWallet },
    }));
  }

  async getByActor(studentId: string, userId: string, roles: RoleName[]) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        guardians: {
          select: {
            id: true,
            relationship: true,
            isPrimaryContact: true,
            canViewAcademic: true,
            canPayFees: true,
            canManageWallet: true,
            guardian: { select: { userId: true } },
          },
        },
        enrolments: {
          where: { status: 'ACTIVE' },
          orderBy: { enrolledAt: 'desc' },
          take: 1,
          include: { academicYear: true, term: true, class: true },
        },
        documents: { select: { id: true, type: true, fileUrl: true, createdAt: true } },
      },
    });

    if (!student) throw new NotFoundException('Student not found.');

    const isPrivilegedStaff = roles.some((role) => PRIVILEGED_STUDENT_READ_ROLES.has(role));
    const linkedGuardian = student.guardians.find((link) => link.guardian.userId === userId);
    const isTeacher = roles.includes(RoleName.TEACHER);

    if (isPrivilegedStaff) {
      return this.toActorView(student, true, true);
    }

    if (linkedGuardian) {
      return this.toActorView(student, false, linkedGuardian.canViewAcademic);
    }

    if (isTeacher) {
      const enrolment = student.enrolments[0];
      const staff = await this.prisma.staff.findUnique({
        where: { userId },
        select: { personId: true },
      });

      if (!staff || !enrolment) {
        throw new ForbiddenException('Teacher access requires an active staff link and student enrolment.');
      }

      const assignment = await this.prisma.teacherAssignment.findFirst({
        where: {
          staffId: staff.personId,
          classId: enrolment.classId,
          termId: enrolment.termId,
        },
        select: { id: true },
      });

      if (!assignment) {
        throw new ForbiddenException('You are not assigned to this student\'s class for the active term.');
      }

      return this.toActorView(student, false, true);
    }

    throw new ForbiddenException('You do not have access to this student.');
  }

  async linkGuardian(studentId: string, actorUserId: string, dto: LinkGuardianDto) {
    return this.prisma.$transaction(async (tx) => {
      const [student, guardian] = await Promise.all([
        tx.student.findUnique({ where: { id: studentId }, select: { id: true, status: true } }),
        tx.guardian.findUnique({ where: { personId: dto.guardianId }, select: { personId: true, userId: true } }),
      ]);

      if (!student) throw new NotFoundException('Student not found.');
      if (student.status !== StudentStatus.ACTIVE) throw new ConflictException('Only active students can receive guardian links.');
      if (!guardian) throw new NotFoundException('Guardian profile not found.');

      const existing = await tx.guardianStudent.findUnique({
        where: { guardianId_studentId: { guardianId: guardian.personId, studentId } },
      });
      if (existing) throw new ConflictException('This guardian is already linked to the student.');

      if (dto.isPrimaryContact) {
        await tx.guardianStudent.updateMany({ where: { studentId }, data: { isPrimaryContact: false } });
      }

      const link = await tx.guardianStudent.create({
        data: {
          guardianId: guardian.personId,
          studentId,
          relationship: dto.relationship.trim(),
          isPrimaryContact: dto.isPrimaryContact ?? false,
          canViewAcademic: dto.canViewAcademic ?? true,
          canPayFees: dto.canPayFees ?? true,
          canManageWallet: dto.canManageWallet ?? true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'GuardianStudent',
          entityId: link.id,
          afterJson: {
            studentId,
            guardianId: guardian.personId,
            relationship: link.relationship,
            isPrimaryContact: link.isPrimaryContact,
            canViewAcademic: link.canViewAcademic,
            canPayFees: link.canPayFees,
            canManageWallet: link.canManageWallet,
          },
        },
      });

      return link;
    });
  }

  async removeGuardian(studentId: string, guardianId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.guardianStudent.findUnique({
        where: { guardianId_studentId: { guardianId, studentId } },
      });
      if (!link) throw new NotFoundException('Guardian link not found.');

      await tx.guardianStudent.delete({ where: { id: link.id } });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'DELETE',
          entityType: 'GuardianStudent',
          entityId: link.id,
          beforeJson: {
            studentId,
            guardianId,
            relationship: link.relationship,
            isPrimaryContact: link.isPrimaryContact,
            canViewAcademic: link.canViewAcademic,
            canPayFees: link.canPayFees,
            canManageWallet: link.canManageWallet,
          },
        },
      });

      return { success: true };
    });
  }

  async withdraw(studentId: string, actorUserId: string, dto: WithdrawStudentDto) {
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        include: {
          enrolments: {
            where: { status: 'ACTIVE' },
            orderBy: { enrolledAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!student) throw new NotFoundException('Student not found.');
      if (student.status !== StudentStatus.ACTIVE) {
        throw new ConflictException('Only an active student can be withdrawn.');
      }

      const activeEnrolment = student.enrolments[0];
      if (!activeEnrolment) {
        throw new ConflictException('Student has no active enrolment to withdraw.');
      }

      const now = new Date();
      const updatedEnrolment = await tx.enrolment.update({
        where: { id: activeEnrolment.id },
        data: {
          status: 'WITHDRAWN',
          completedAt: now,
          exitReason: dto.reason.trim(),
        },
      });

      const updatedStudent = await tx.student.update({
        where: { id: studentId },
        data: { status: StudentStatus.WITHDRAWN },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'Student',
          entityId: studentId,
          beforeJson: {
            status: student.status,
            enrolment: { id: activeEnrolment.id, status: activeEnrolment.status },
          },
          afterJson: {
            status: updatedStudent.status,
            enrolment: {
              id: updatedEnrolment.id,
              status: updatedEnrolment.status,
              exitReason: updatedEnrolment.exitReason,
            },
          },
        },
      });

      return {
        student: { id: updatedStudent.id, status: updatedStudent.status },
        enrolment: {
          id: updatedEnrolment.id,
          status: updatedEnrolment.status,
          completedAt: updatedEnrolment.completedAt,
          exitReason: updatedEnrolment.exitReason,
        },
      };
    });
  }

  private toActorView(
    student: {
      id: string;
      admissionNumber: string | null;
      firstName: string;
      lastName: string;
      dateOfBirth: Date;
      sex: string | null;
      hometown: string | null;
      region: string | null;
      passportPhotoUrl: string | null;
      previousSchool: string | null;
      status: string;
      admittedAt: Date | null;
      guardians: Array<{
        id: string;
        relationship: string;
        isPrimaryContact: boolean;
        canViewAcademic: boolean;
        canPayFees: boolean;
        canManageWallet: boolean;
        guardian: { userId: string | null };
      }>;
      enrolments: Array<{
        id: string;
        status: string;
        enrolledAt: Date;
        completedAt: Date | null;
        classId: string;
        termId: string;
        level: string;
        programme: string;
        academicYear: { id: string; name: string };
        term: { id: string; code: string; name: string };
        class: { id: string; name: string; level: string; programme: string };
      }>;
      documents: Array<{ id: string; type: string; fileUrl: string; createdAt: Date }>;
    },
    includeDocuments: boolean,
    includeAcademic: boolean,
  ) {
    return {
      student: this.toStudentView(student),
      guardians: student.guardians.map((link) => ({
        relationship: link.relationship,
        isPrimaryContact: link.isPrimaryContact,
      })),
      enrolments: includeAcademic
        ? student.enrolments.map((enrolment) => ({
            id: enrolment.id,
            status: enrolment.status,
            enrolledAt: enrolment.enrolledAt,
            completedAt: enrolment.completedAt,
            academicYear: { id: enrolment.academicYear.id, name: enrolment.academicYear.name },
            term: { id: enrolment.term.id, code: enrolment.term.code, name: enrolment.term.name },
            class: {
              id: enrolment.class.id,
              name: enrolment.class.name,
              level: enrolment.level,
              programme: enrolment.programme,
            },
          }))
        : [],
      documents: includeDocuments ? student.documents : [],
    };
  }

  private toStudentView(student: {
    id: string;
    admissionNumber: string | null;
    firstName: string;
    lastName: string;
    dateOfBirth: Date;
    sex: string | null;
    hometown: string | null;
    region: string | null;
    passportPhotoUrl: string | null;
    previousSchool: string | null;
    status: string;
    admittedAt: Date | null;
  }) {
    return {
      id: student.id,
      admissionNumber: student.admissionNumber,
      firstName: student.firstName,
      lastName: student.lastName,
      dateOfBirth: student.dateOfBirth,
      sex: student.sex,
      hometown: student.hometown,
      region: student.region,
      passportPhotoUrl: student.passportPhotoUrl,
      previousSchool: student.previousSchool,
      status: student.status,
      admittedAt: student.admittedAt,
    };
  }
}
