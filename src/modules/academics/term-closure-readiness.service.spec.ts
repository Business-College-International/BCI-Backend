import { BadRequestException } from '@nestjs/common';
import { TermClosureReadinessService } from './term-closure-readiness.service';

describe('TermClosureReadinessService', () => {
  it('reports the major closure blockers', async () => {
    const prisma = {
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', code: 'T1', name: 'Term 1', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-06-30'), status: 'OPEN' }) },
      enrolment: { findMany: jest.fn().mockResolvedValue([{ studentId: 'student-1' }, { studentId: 'student-2' }]) },
      assessment: { findMany: jest.fn().mockResolvedValue([{ id: 'assessment-1' }]) },
      assessmentResult: { findMany: jest.fn().mockResolvedValue([{ studentId: 'student-1', assessmentId: 'assessment-1' }]) },
      attendanceSession: { count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(2) },
    };
    const service = new TermClosureReadinessService(prisma as never);
    const result = await service.get('term-1');
    expect(result.readiness.studentsWithMissingAssessmentResults).toBe(1);
    expect(result.blockers).toContain('MISSING_ASSESSMENT_RESULTS');
    expect(result.blockers).toContain('UNPUBLISHED_ATTENDANCE_SESSIONS');
  });

  it('rejects readiness checks for non-open terms', async () => {
    const prisma = { term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', status: 'CLOSED' }) } };
    const service = new TermClosureReadinessService(prisma as never);
    await expect(service.get('term-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
