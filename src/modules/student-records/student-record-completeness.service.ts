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

type CompletenessFinding = {
  code: string;
  message: string;
  severity: 'BLOCKING' | 'WARNING' | 'INFO';
};

@Injectable()
export class StudentRecordCompletenessService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentCompleteness(studentId: string, roles: RoleName[]) {
    if (!roles.some((role) => STAFF_ROLES.has(role))) {
      throw new ForbiddenException('Student record completeness access is restricted.');
    }

    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        guardians: {
          include: {
            guardian: {
              select: {
                personId: true,
                userId: true,
                preferredSms: true,
                preferredPush: true,
                person: { select: { firstName: true, lastName: true, phone: true, email: true } },
              },
            },
          },
          orderBy: { isPrimaryContact: 'desc' },
        },
        documents: { select: { id: true, type: true, createdAt: true } },
        enrolments: {
          where: { status: 'ACTIVE' },
          orderBy: { enrolledAt: 'desc' },
          take: 1,
          select: {
            id: true,
            level: true,
            programme: true,
            class: { select: { id: true, name: true, level: true, programme: true } },
            term: { select: { id: true, code: true, name: true, status: true } },
          },
        },
        application: { select: { id: true, previousSchool: true, guardianName: true, guardianPhone: true, passportPhotoUrl: true } },
        wallet: { select: { studentId: true } },
      },
    });

    if (!student) throw new NotFoundException('Student not found.');

    const findings: CompletenessFinding[] = [];
    const requiredChecks = [
      { present: Boolean(student.firstName.trim() && student.lastName.trim()), code: 'NAME_MISSING', message: 'Student name is incomplete.' },
      { present: Boolean(student.dateOfBirth), code: 'DATE_OF_BIRTH_MISSING', message: 'Date of birth is missing.' },
      { present: Boolean(student.admissionNumber), code: 'ADMISSION_NUMBER_MISSING', message: 'Admission number is missing.' },
      { present: Boolean(student.passportPhotoUrl || student.application?.passportPhotoUrl), code: 'PASSPORT_PHOTO_MISSING', message: 'Passport photo is missing.' },
      { present: Boolean(student.previousSchool || student.application?.previousSchool), code: 'PREVIOUS_SCHOOL_MISSING', message: 'Previous school is missing.' },
      { present: Boolean(student.hometown), code: 'HOMETOWN_MISSING', message: 'Hometown is missing.' },
      { present: Boolean(student.region), code: 'REGION_MISSING', message: 'Region is missing.' },
      { present: Boolean(student.guardians.some((link) => link.isPrimaryContact)), code: 'PRIMARY_GUARDIAN_MISSING', message: 'No primary guardian is linked.' },
      { present: Boolean(student.guardians.some((link) => Boolean(link.guardian.person.phone))), code: 'GUARDIAN_PHONE_MISSING', message: 'No linked guardian has a phone number.' },
      { present: Boolean(student.enrolments.length > 0), code: 'ACTIVE_ENROLMENT_MISSING', message: 'Student has no active enrolment.' },
    ];

    for (const check of requiredChecks) {
      if (!check.present) findings.push({ code: check.code, message: check.message, severity: 'BLOCKING' });
    }

    if (student.documents.length === 0) {
      findings.push({ code: 'NO_STUDENT_DOCUMENTS', message: 'No student documents are stored.', severity: 'WARNING' });
    }

    if (student.guardians.length === 0) {
      findings.push({ code: 'NO_GUARDIAN_LINK', message: 'No guardian relationship is linked to the student.', severity: 'BLOCKING' });
    }

    findings.push({
      code: 'EMERGENCY_CONTACT_SCHEMA_GAP',
      message: 'EmergencyContact exists at the Person level but is not linked to Student in the current schema; emergency-contact completeness cannot be verified yet.',
      severity: 'WARNING',
    });

    if (!student.guardians.some((link) => link.guardian.preferredSms)) {
      findings.push({ code: 'GUARDIAN_SMS_DISABLED', message: 'All linked guardians have SMS preference disabled.', severity: 'INFO' });
    }

    const totalChecks = requiredChecks.length;
    const passedChecks = requiredChecks.filter((check) => check.present).length;
    const score = Math.round((passedChecks / totalChecks) * 100);

    return {
      student: {
        id: student.id,
        admissionNumber: student.admissionNumber,
        name: `${student.firstName} ${student.lastName}`,
        status: student.status,
      },
      currentPlacement: student.enrolments[0]
        ? {
            enrolmentId: student.enrolments[0].id,
            level: student.enrolments[0].level,
            programme: student.enrolments[0].programme,
            class: student.enrolments[0].class,
            term: student.enrolments[0].term,
          }
        : null,
      linkedGuardians: student.guardians.map((link) => ({
        guardianId: link.guardian.personId,
        name: `${link.guardian.person.firstName} ${link.guardian.person.lastName}`,
        phone: link.guardian.person.phone,
        email: link.guardian.person.email,
        relationship: link.relationship,
        primary: link.isPrimaryContact,
        canViewAcademic: link.canViewAcademic,
        canPayFees: link.canPayFees,
        canManageWallet: link.canManageWallet,
      })),
      documents: student.documents,
      score,
      readyForCompleteRecord: !findings.some((finding) => finding.severity === 'BLOCKING'),
      findings,
    };
  }
}
