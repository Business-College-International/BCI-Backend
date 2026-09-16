import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class TermClosureReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async get(termId: string) {
    const term = await this.prisma.term.findUnique({ where: { id: termId } });
    if (!term) throw new NotFoundException('Term not found.');
    if (term.status !== 'OPEN') throw new BadRequestException('Closure readiness is only available for an open term.');

    const [enrolments, assessments, assessmentResults, attendanceSessions, publishedAttendanceSessions] = await Promise.all([
      this.prisma.enrolment.findMany({ where: { termId, status: 'ACTIVE' }, select: { studentId: true } }),
      this.prisma.assessment.findMany({ where: { termId }, select: { id: true } }),
      this.prisma.assessmentResult.findMany({ where: { assessment: { termId } }, select: { studentId: true, assessmentId: true } }),
      this.prisma.attendanceSession.count({ where: { termId } }),
      this.prisma.attendanceSession.count({ where: { termId, publishedAt: { not: null } } }),
    ]);

    const activeStudentIds = new Set(enrolments.map((entry) => entry.studentId));
    const resultsByStudent = new Map<string, Set<string>>();
    for (const result of assessmentResults) {
      if (!activeStudentIds.has(result.studentId)) continue;
      const existing = resultsByStudent.get(result.studentId) ?? new Set<string>();
      existing.add(result.assessmentId);
      resultsByStudent.set(result.studentId, existing);
    }

    const studentsWithMissingAssessmentResults = assessments.length === 0
      ? activeStudentIds.size
      : Array.from(activeStudentIds).filter((studentId) => (resultsByStudent.get(studentId)?.size ?? 0) < assessments.length).length;

    return {
      term: {
        id: term.id,
        code: term.code,
        name: term.name,
        startsAt: term.startsAt,
        endsAt: term.endsAt,
        status: term.status,
      },
      readiness: {
        activeEnrolments: enrolments.length,
        assessmentCount: assessments.length,
        assessmentResultCount: assessmentResults.length,
        studentsWithMissingAssessmentResults,
        attendanceSessionCount: attendanceSessions,
        publishedAttendanceSessionCount: publishedAttendanceSessions,
        termEndReached: new Date() >= term.endsAt,
      },
      blockers: [
        ...(new Date() < term.endsAt ? ['TERM_END_NOT_REACHED'] : []),
        ...(assessments.length === 0 && enrolments.length > 0 ? ['NO_ASSESSMENTS'] : []),
        ...(studentsWithMissingAssessmentResults > 0 ? ['MISSING_ASSESSMENT_RESULTS'] : []),
        ...(attendanceSessions > publishedAttendanceSessions ? ['UNPUBLISHED_ATTENDANCE_SESSIONS'] : []),
      ],
    };
  }
}
