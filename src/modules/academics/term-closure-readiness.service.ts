import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class TermClosureReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async get(termId: string) {
    const term = await this.prisma.term.findUnique({ where: { id: termId } });
    if (!term) throw new NotFoundException('Term not found.');
    if (term.status !== 'OPEN') throw new BadRequestException('Closure readiness is only available for an open term.');

    const [activeEnrolments, assessments, assessmentResults, attendanceSessions, publishedAttendanceSessions] = await Promise.all([
      this.prisma.enrolment.count({ where: { termId, status: 'ACTIVE' } }),
      this.prisma.assessment.count({ where: { termId } }),
      this.prisma.assessmentResult.count({ where: { assessment: { termId } } }),
      this.prisma.attendanceSession.count({ where: { termId } }),
      this.prisma.attendanceSession.count({ where: { termId, publishedAt: { not: null } } }),
    ]);

    const studentsWithMissingAssessmentResults = assessments === 0
      ? activeEnrolments
      : await this.prisma.enrolment.count({
          where: {
            termId,
            status: 'ACTIVE',
            student: {
              assessmentResults: {
                none: { assessment: { termId } },
              },
            },
          },
        });

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
        activeEnrolments,
        assessmentCount: assessments,
        assessmentResultCount: assessmentResults,
        studentsWithMissingAssessmentResults,
        attendanceSessionCount: attendanceSessions,
        publishedAttendanceSessionCount: publishedAttendanceSessions,
        termEndReached: new Date() >= term.endsAt,
      },
      blockers: [
        ...(new Date() < term.endsAt ? ['TERM_END_NOT_REACHED'] : []),
        ...(assessments === 0 && activeEnrolments > 0 ? ['NO_ASSESSMENTS'] : []),
        ...(studentsWithMissingAssessmentResults > 0 ? ['MISSING_ASSESSMENT_RESULTS'] : []),
        ...(attendanceSessions > publishedAttendanceSessions ? ['UNPUBLISHED_ATTENDANCE_SESSIONS'] : []),
      ],
    };
  }
}
