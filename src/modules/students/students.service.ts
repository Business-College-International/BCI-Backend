import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName, StudentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
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

    return guardian.wards.map(({ student, relationship, isPrimaryContact }) => ({
      student: this.toStudentView(student),
      relationship,
      isPrimaryContact,
    }));
  }

  async getByActor(studentId: string, userId: string, roles: RoleName[]) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        guardians: {
          select: {
            relationship: true,
            isPrimaryContact: true,
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
    const isLinkedGuardian = student.guardians.some((link) => link.guardian.userId === userId);
    const isTeacher = roles.includes(RoleName.TEACHER);

    if (isPrivilegedStaff) {
      return this.toActorView(student, true);
    }

    if (isLinkedGuardian) {
      return this.toActorView(student, false);
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

      return this.toActorView(student, false);
    }

    throw new ForbiddenException('You do not have access to this student.');
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
            enrolment: {
              id: activeEnrolment.id,
              status: activeEnrolment.status,
            },
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
        student: {
          id: updatedStudent.id,
          status: updatedStudent.status,
        },
        enrolment: {
          id: updatedEnrolment.id,
          status: updatedEnrolment.status,
          completedAt: updatedEnrolment.completedAt,
          exitReason: updatedEnrolment.exitReason,
        },
      };
    });
  }

  private toActorView(student: {
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
    guardians: Array<{ relationship: string; isPrimaryContact: boolean; guardian: { userId: string | null } }>;
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
  }, includeDocuments: boolean) {
    return {
      student: this.toStudentView(student),
      guardians: student.guardians.map((link) => ({
        relationship: link.relationship,
        isPrimaryContact: link.isPrimaryContact,
      })),
      enrolments: student.enrolments.map((enrolment) => ({
        id: enrolment.id,
        status: enrolment.status,
        enrolledAt: enrolment.enrolledAt,
        completedAt: enrolment.completedAt,
        academicYear: {
          id: enrolment.academicYear.id,
          name: enrolment.academicYear.name,
        },
        term: {
          id: enrolment.term.id,
          code: enrolment.term.code,
          name: enrolment.term.name,
        },
        class: {
          id: enrolment.class.id,
          name: enrolment.class.name,
          level: enrolment.level,
          programme: enrolment.programme,
        },
      })),
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
