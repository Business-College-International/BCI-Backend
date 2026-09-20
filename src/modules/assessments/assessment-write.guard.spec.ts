import { BadRequestException } from '@nestjs/common';
import { AssessmentWriteGuard } from './assessment-write.guard';

function contextFor(assessmentId = 'assessment-1', body: unknown = { results: [] }) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params: { assessmentId }, body }),
    }),
  } as any;
}

describe('AssessmentWriteGuard', () => {
  it('allows result writes while the term is open', async () => {
    const prisma = {
      assessment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'assessment-1', termId: 'term-1', term: { status: 'OPEN' } }),
      },
    };
    const guard = new AssessmentWriteGuard(prisma as never);
    await expect(guard.canActivate(contextFor())).resolves.toBe(true);
  });

  it('rejects result writes after the term is closed', async () => {
    const prisma = {
      assessment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'assessment-1', termId: 'term-1', term: { status: 'CLOSED' } }),
      },
    };
    const guard = new AssessmentWriteGuard(prisma as never);
    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks edits to a student whose report card is already published without a pending correction request', async () => {
    const prisma = {
      assessment: { findUnique: jest.fn().mockResolvedValue({ id: 'assessment-1', termId: 'term-1', term: { status: 'OPEN' } }) },
      reportCardPublication: { findMany: jest.fn().mockResolvedValue([{ id: 'pub-1', studentId: 'student-1' }]) },
      reportCardCorrectionRequest: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const guard = new AssessmentWriteGuard(prisma as never);

    await expect(
      guard.canActivate(contextFor('assessment-1', { results: [{ studentId: 'student-1', score: 90 }] })),
    ).rejects.toThrow('Submit a correction request');

    expect(prisma.reportCardCorrectionRequest.findMany).toHaveBeenCalled();
  });

  it('allows edits covered by a pending correction request for the current publication', async () => {
    const prisma = {
      assessment: { findUnique: jest.fn().mockResolvedValue({ id: 'assessment-1', termId: 'term-1', term: { status: 'OPEN' } }) },
      reportCardPublication: { findMany: jest.fn().mockResolvedValue([{ id: 'pub-1', studentId: 'student-1' }]) },
      reportCardCorrectionRequest: { findMany: jest.fn().mockResolvedValue([{ studentId: 'student-1', targetPublicationId: 'pub-1' }]) },
    };
    const guard = new AssessmentWriteGuard(prisma as never);

    await expect(
      guard.canActivate(contextFor('assessment-1', { results: [{ studentId: 'student-1', score: 90 }] })),
    ).resolves.toBe(true);
  });

  it('blocks a mixed batch when even one published student has no correction request', async () => {
    const prisma = {
      assessment: { findUnique: jest.fn().mockResolvedValue({ id: 'assessment-1', termId: 'term-1', term: { status: 'OPEN' } }) },
      reportCardPublication: { findMany: jest.fn().mockResolvedValue([
        { id: 'pub-1', studentId: 'student-1' },
        { id: 'pub-2', studentId: 'student-2' },
      ]) },
      reportCardCorrectionRequest: { findMany: jest.fn().mockResolvedValue([{ studentId: 'student-1', targetPublicationId: 'pub-1' }]) },
    };
    const guard = new AssessmentWriteGuard(prisma as never);

    await expect(
      guard.canActivate(contextFor('assessment-1', {
        results: [
          { studentId: 'student-1', score: 90 },
          { studentId: 'student-2', score: 90 },
        ],
      })),
    ).rejects.toThrow('Submit a correction request');
  });

});
