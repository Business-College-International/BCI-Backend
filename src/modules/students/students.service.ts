import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const STAFF_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
  RoleName.ACCOUNTANT,
  RoleName.TEACHER,
  RoleName.SUPPORT_STAFF,
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
          include: { guardian: { include: { user: true } } },
        },
        enrolments: {
          orderBy: { enrolledAt: 'desc' },
          take: 3,
          include: { academicYear: true, term: true, class: true },
        },
        documents: { select: { id: true, type: true, fileUrl: true, createdAt: true } },
      },
    });

    if (!student) throw new NotFoundException('Student not found.');

    const isStaff = roles.some((role) => STAFF_ROLES.has(role));
    const isLinkedGuardian = student.guardians.some((link) => link.guardian.userId === userId);

    if (!isStaff && !isLinkedGuardian) {
      throw new ForbiddenException('You do not have access to this student.');
    }

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
      documents: isStaff ? student.documents : [],
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
