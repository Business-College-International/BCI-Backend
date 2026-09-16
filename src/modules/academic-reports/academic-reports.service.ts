import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName, TermStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const PRIVILEGED_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
]);

@Injectable()
export class AcademicReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentStudentTermSummary(studentId: string, actorUserId: string, roles: RoleName[]) {
    const currentYear = await this.prisma.academicYear.findFirst({
      where: { isCurrent: true },
      select: { id: true },
    });
    if (!currentYear) throw new NotFoundException('No current academic year is configured.');

    const currentTerm = await this.prisma.term.findFirst({
      where: { academicYearId: currentYear.id, status: TermStatus.OPEN },
      orderBy: { startsAt: 'desc' },
      select: { id: true },
    });
    if (!currentTerm) throw new NotFoundException('No open term is configured for the current academic year.');

    return this.getStudentTermSummary(studentId, currentTerm.id, actorUserId, roles);
  }

  async getStudentTermSummary(studentId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, admissionNumber: true, firstName: true, lastName: true, status: true },
    });
    if (!student) throw new NotFoundException('Student not found.');

    const term = await this.prisma.term.findUnique({
      where: { id: termId },
      select: { id: true, code: true, name: true, startsAt: true, endsAt: true, academicYearId: true },
    });
    if (!term) throw new NotFoundException('Term not found.');

    const enrolment = await this.prisma.enrolment.findFirst({
      where: { studentId, termId, status: 'ACTIVE' },
      select: {
        id: true,
        classId: true,
        level: true,
        programme: true,
        class: { select: { id: true, name: true, division: true, room: true } },
      },
    });

    const scope = await this.resolveScope(studentId, termId, actorUserId, roles);
    if (!scope.allowed) throw new ForbiddenException('You do not have access to this academic report.');
    if (scope.guardianRestricted) {
      throw new ForbiddenException('This guardian is not permitted to view academic records for this ward.');
    }

    const [results, attendanceRecords] = await Promise.all([
      this.prisma.assessmentResult.findMany({
        where: { studentId, assessment: { termId } },
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
      }),
      this.prisma.attendanceRecord.findMany({
        where: {
          studentId,
          session: {
            termId,
            ...(enrolment ? { classId: enrolment.classId } : {}),
          },
        },
        select: {
          id: true,
          status: true,
          markedAt: true,
          session: {
            select: { id: true, sessionDate: true, subjectId: true, periodLabel: true },
          },
        },
        orderBy: { session: { sessionDate: 'asc' } },
      }),
    ]);

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

    let overallPercentage: number | null = null;
    let mode: 'WEIGHTED' | 'UNWEIGHTED_AVERAGE' | 'MIXED_POLICY_REQUIRED' | 'NO_RESULTS' = 'NO_RESULTS';

    if (weightedRows.length > 0 && unweightedRows.length === 0) {
      overallPercentage = Number(weightedContributionTotal.toFixed(2));
      mode = 'WEIGHTED';
    } else if (weightedRows.length === 0 && unweightedRows.length > 0) {
      overallPercentage = Number((unweightedPercentageTotal / unweightedRows.length).toFixed(2));
      mode = 'UNWEIGHTED_AVERAGE';
    } else if (weightedRows.length > 0 && unweightedRows.length > 0) {
      mode = 'MIXED_POLICY_REQUIRED';
    }

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

    const attendanceCounts = attendanceRecords.reduce(
      (acc, record) => {
        acc.total += 1;
        acc[record.status] += 1;
        return acc;
      },
      { total: 0, PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 } as Record<string, number>,
    );
    const attendanceRate = attendanceCounts.total === 0
      ? null
      : Number((((attendanceCounts.PRESENT + attendanceCounts.LATE) / attendanceCounts.total) * 100).toFixed(2));

    return {
      student,
      term: {
        id: term.id,
        code: term.code,
        name: term.name,
        startsAt: term.startsAt,
        endsAt: term.endsAt,
      },
      placement: enrolment
        ? {
            enrolmentId: enrolment.id,
            level: enrolment.level,
            programme: enrolment.programme,
            class: enrolment.class,
          }
        : null,
      calculation: {
        overallPercentage,
        mode,
        weightedAssessmentCount: weightedRows.length,
        unweightedAssessmentCount: unweightedRows.length,
        totalConfiguredWeight: weightTotal || null,
      },
      subjects,
      assessments: rows,
      attendance: {
        totalMarkedSessions: attendanceCounts.total,
        present: attendanceCounts.PRESENT,
        absent: attendanceCounts.ABSENT,
        late: attendanceCounts.LATE,
        excused: attendanceCounts.EXCUSED,
        attendanceRate,
        sessions: attendanceRecords.map((record) => ({
          id: record.id,
          status: record.status,
          markedAt: record.markedAt,
          session: record.session,
        })),
      },
      grading: {
        assigned: false,
        reason: 'No configurable school grading-band policy has been applied yet.',
      },
      publication: {
        state: 'DRAFT_VIEW',
        persisted: false,
        immutableSnapshotId: null,
      },
    };
  }

  private async resolveScope(studentId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_ROLES.has(role))) return { allowed: true, guardianRestricted: false };

    const guardian = await this.prisma.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
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
