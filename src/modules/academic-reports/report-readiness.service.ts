import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName, TermStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const PRIVILEGED_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);

type ReadinessReason = 'TERM_NOT_CLOSED' | 'NO_ASSESSMENTS' | 'MISSING_RESULTS' | 'MIXED_WEIGHT_POLICY' | 'GRADING_POLICY_REQUIRED' | 'NO_ACTIVE_ENROLMENT';

@Injectable()
export class ReportReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async getClassReadiness(classId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    const term = await this.prisma.term.findUnique({ where: { id: termId }, select: { id: true, name: true, status: true, academicYearId: true } });
    const schoolClass = await this.prisma.schoolClass.findUnique({ where: { id: classId }, select: { id: true, name: true, academicYearId: true, level: true, programme: true } });
    if (!term || !schoolClass) throw new NotFoundException('Class or term not found.');
    if (term.academicYearId !== schoolClass.academicYearId) throw new NotFoundException('Class and term do not belong to the same academic year.');

    await this.assertScope(classId, termId, actorUserId, roles);

    const enrolments = await this.prisma.enrolment.findMany({
      where: { classId, termId, status: 'ACTIVE' },
      select: { studentId: true, student: { select: { admissionNumber: true, firstName: true, lastName: true } } },
      orderBy: { student: { lastName: 'asc' } },
      take: 500,
    });

    const assessments = await this.prisma.assessment.findMany({
      where: { termId, subject: { assignments: { some: { classId, termId } } } },
      select: { id: true, title: true, type: true, subjectId: true, weight: true, maxScore: true, subject: { select: { code: true, name: true } } },
      orderBy: [{ subject: { name: 'asc' } }, { createdAt: 'asc' }],
    });

    const results = enrolments.length === 0 || assessments.length === 0
      ? []
      : await this.prisma.assessmentResult.findMany({
          where: { studentId: { in: enrolments.map((item) => item.studentId) }, assessmentId: { in: assessments.map((item) => item.id) } },
          select: { studentId: true, assessmentId: true },
        });

    const resultKeys = new Set(results.map((item) => `${item.studentId}:${item.assessmentId}`));
    const weightedCount = assessments.filter((assessment) => assessment.weight !== null).length;
    const unweightedCount = assessments.filter((assessment) => assessment.weight === null).length;

    const baseReasons: ReadinessReason[] = [];
    if (term.status !== TermStatus.CLOSED) baseReasons.push('TERM_NOT_CLOSED');
    if (assessments.length === 0) baseReasons.push('NO_ASSESSMENTS');
    if (weightedCount > 0 && unweightedCount > 0) baseReasons.push('MIXED_WEIGHT_POLICY');

    const gradingPolicy = schoolClass.programme === 'NONE'
      ? await this.prisma.gradingPolicy.findFirst({
          where: {
            academicYearId: term.academicYearId,
            level: schoolClass.level,
            programme: null,
            status: 'ACTIVE',
          },
          select: { id: true, version: true },
        })
      : await this.prisma.gradingPolicy.findFirst({
          where: {
            academicYearId: term.academicYearId,
            level: schoolClass.level,
            programme: schoolClass.programme,
            status: 'ACTIVE',
          },
          select: { id: true, version: true },
        }) ??
        await this.prisma.gradingPolicy.findFirst({
          where: {
            academicYearId: term.academicYearId,
            level: schoolClass.level,
            programme: null,
            status: 'ACTIVE',
          },
          select: { id: true, version: true },
        });

    if (!gradingPolicy) baseReasons.push('GRADING_POLICY_REQUIRED');

    const students = enrolments.map((enrolment) => {
      const missingAssessments = assessments.filter((assessment) => !resultKeys.has(`${enrolment.studentId}:${assessment.id}`)).map((assessment) => ({
        assessmentId: assessment.id,
        title: assessment.title,
        type: assessment.type,
        subject: assessment.subject,
      }));
      const reasons = [...baseReasons];
      if (missingAssessments.length > 0) reasons.push('MISSING_RESULTS');
      const uniqueReasons = Array.from(new Set(reasons));
      return {
        student: { id: enrolment.studentId, admissionNumber: enrolment.student.admissionNumber, firstName: enrolment.student.firstName, lastName: enrolment.student.lastName },
        ready: uniqueReasons.length === 0,
        reasons: uniqueReasons,
        missingAssessments,
      };
    });

    return {
      class: schoolClass,
      term,
      policy: {
        gradingConfigured: Boolean(gradingPolicy),
        policyVersionId: gradingPolicy?.id ?? null,
        policyVersion: gradingPolicy?.version ?? null,
        reason: gradingPolicy ? null : 'No active grading policy is configured for this class scope.',
      },
      totals: {
        activeStudents: enrolments.length,
        expectedAssessments: assessments.length,
        readyStudents: students.filter((student) => student.ready).length,
        blockedStudents: students.filter((student) => !student.ready).length,
      },
      students,
    };
  }

  private async assertScope(classId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_ROLES.has(role))) return;
    if (!roles.includes(RoleName.TEACHER)) throw new ForbiddenException('You do not have access to report readiness for this class.');

    const staff = await this.prisma.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!staff) throw new ForbiddenException('You do not have access to report readiness for this class.');

    const assignment = await this.prisma.teacherAssignment.findFirst({ where: { staffId: staff.personId, classId, termId }, select: { id: true } });
    if (!assignment) throw new ForbiddenException('You are not assigned to this class for this term.');
  }
}