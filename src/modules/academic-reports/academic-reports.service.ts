import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const PRIVILEGED_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
]);

@Injectable()
export class AcademicReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentTermSummary(studentId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, admissionNumber: true, firstName: true, lastName: true, status: true },
    });
    if (!student) throw new NotFoundException('Student not found.');

    const term = await this.prisma.term.findUnique({
      where: { id: termId },
      select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
    });
    if (!term) throw new NotFoundException('Term not found.');

    const scope = await this.resolveScope(studentId, termId, actorUserId, roles);
    if (!scope.allowed) throw new ForbiddenException('You do not have access to this academic report.');
    if (scope.guardianRestricted) {
      throw new ForbiddenException('This guardian is not permitted to view academic records for this ward.');
    }

    const results = await this.prisma.assessmentResult.findMany({
      where: {
        studentId,
        assessment: { termId },
      },
      include: {
        assessment: {
          select: {
            id: true,
            title: true,
            type: true,
            maxScore: true,
            weight: true,
            subject: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: [{ assessment: { subject: { name: 'asc' } } }, { assessment: { createdAt: 'asc' } }],
    });

    const rows = results.map((result) => {
      const maxScore = Number(result.assessment.maxScore.toString());
      const score = Number(result.score.toString());
      const percentage = maxScore === 0 ? 0 : (score / maxScore) * 100;
      const weight = result.assessment.weight == null ? null : Number(result.assessment.weight.toString());
      const weightedContribution = weight == null ? null : (percentage * weight) / 100;

      return {
        id: result.id,
        score: result.score.toString(),
        maxScore: result.assessment.maxScore.toString(),
        percentage: Number(percentage.toFixed(2)),
        weight,
        weightedContribution: weightedContribution == null ? null : Number(weightedContribution.toFixed(2)),
        remark: result.remark,
        enteredAt: result.enteredAt,
        assessment: {
          id: result.assessment.id,
          title: result.assessment.title,
          type: result.assessment.type,
          subject: result.assessment.subject,
        },
      };
    });

    const weightedRows = rows.filter((row) => row.weight !== null);
    const unweightedRows = rows.filter((row) => row.weight === null);
    const weightTotal = weightedRows.reduce((sum, row) => sum + (row.weight ?? 0), 0);
    const weightedContributionTotal = weightedRows.reduce((sum, row) => sum + (row.weightedContribution ?? 0), 0);
    const unweightedPercentageTotal = unweightedRows.reduce((sum, row) => sum + row.percentage, 0);

    const overall = weightTotal > 0
      ? Number(weightedContributionTotal.toFixed(2))
      : rows.length > 0
        ? Number(((unweightedPercentageTotal / rows.length)).toFixed(2))
        : null;

    const subjectMap = new Map<string, { code: string; name: string; percentages: number[] }>();
    for (const row of rows) {
      const code = row.assessment.subject.code;
      const current = subjectMap.get(code) ?? { code, name: row.assessment.subject.name, percentages: [] };
      current.percentages.push(row.percentage);
      subjectMap.set(code, current);
    }

    const subjects = Array.from(subjectMap.values()).map((subject) => ({
      code: subject.code,
      name: subject.name,
      assessmentCount: subject.percentages.length,
      averagePercentage: Number((subject.percentages.reduce((sum, value) => sum + value, 0) / subject.percentages.length).toFixed(2)),
    }));

    return {
      student,
      term,
      calculation: {
        overallPercentage: overall,
        mode: weightTotal > 0 ? 'WEIGHTED' : rows.length > 0 ? 'UNWEIGHTED_AVERAGE' : 'NO_RESULTS',
        weightedAssessmentCount: weightedRows.length,
        unweightedAssessmentCount: unweightedRows.length,
        totalConfiguredWeight: weightTotal || null,
      },
      subjects,
      assessments: rows,
      grading: {
        assigned: false,
        reason: 'No configurable school grading-band policy has been applied yet.',
      },
    };
  }

  private async resolveScope(studentId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_ROLES.has(role))) {
      return { allowed: true, guardianRestricted: false };
    }

    const guardian = await this.prisma.guardian.findUnique({
      where: { userId: actorUserId },
      select: { personId: true },
    });
    if (guardian) {
      const link = await this.prisma.guardianStudent.findUnique({
        where: { guardianId_studentId: { guardianId: guardian.personId, studentId } },
        select: { canViewAcademic: true },
      });
      if (link) return { allowed: true, guardianRestricted: !link.canViewAcademic };
    }

    if (roles.includes(RoleName.TEACHER)) {
      const staff = await this.prisma.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
      const enrolment = await this.prisma.enrolment.findFirst({
        where: { studentId, termId, status: 'ACTIVE' },
        select: { classId: true },
      });
      if (staff && enrolment) {
        const assignment = await this.prisma.teacherAssignment.findFirst({
          where: { staffId: staff.personId, classId: enrolment.classId, termId },
          select: { id: true },
        });
        if (assignment) return { allowed: true, guardianRestricted: false };
      }
    }

    return { allowed: false, guardianRestricted: false };
  }
}
