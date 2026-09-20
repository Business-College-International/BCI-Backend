import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class TermClosureReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async get(termId: string) {
    return this.evaluate(this.prisma, termId);
  }

  async assertReadyForClosure(tx: Prisma.TransactionClient, termId: string) {
    const result = await this.evaluate(tx, termId);
    if (result.blockers.length > 0) {
      throw new BadRequestException('Term is not ready for closure: ' + result.blockers.join(', '));
    }
    return result;
  }

  private async evaluate(client: PrismaService | Prisma.TransactionClient, termId: string) {
    const term = await client.term.findUnique({ where: { id: termId } });
    if (!term) throw new NotFoundException('Term not found.');
    if (term.status !== 'OPEN') throw new BadRequestException('Closure readiness is only available for an open term.');

    const [enrolments, assessments, assessmentResults, attendanceSessions, publishedAttendanceSessions] = await Promise.all([
      client.enrolment.findMany({ where: { termId, status: 'ACTIVE' }, select: { studentId: true } }),
      client.assessment.findMany({ where: { termId }, select: { id: true } }),
      client.assessmentResult.findMany({ where: { assessment: { termId } }, select: { studentId: true, assessmentId: true } }),
      client.attendanceSession.count({ where: { termId } }),
      client.attendanceSession.count({ where: { termId, publishedAt: { not: null } } }),
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
