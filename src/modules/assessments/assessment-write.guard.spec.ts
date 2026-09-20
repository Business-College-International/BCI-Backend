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

  it('blocks a closed-term result write without a current correction request', async () => {
    const prisma = {
      assessment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'assessment-1',
          termId: 'term-1',
          term: { status: 'CLOSED' },
        }),
      },
      reportCardPublication: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      reportCardCorrectionRequest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const guard = new AssessmentWriteGuard(prisma as never);

    await expect(
      guard.canActivate(
        contextFor('assessment-1', { results: [{ studentId: 'student-1', score: 40 }] }),
      ),
    ).rejects.toThrow('Closed-term assessment changes require');
  });

  it('allows a closed-term result write for a student with a pending correction request', async () => {
    const prisma = {
      assessment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'assessment-1',
          termId: 'term-1',
          term: { status: 'CLOSED' },
        }),
      },
      reportCardPublication: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'pub-1', studentId: 'student-1' },
        ]),
      },
      reportCardCorrectionRequest: {
        findMany: jest.fn().mockResolvedValue([
          { studentId: 'student-1' },
        ]),
      },
    };
    const guard = new AssessmentWriteGuard(prisma as never);

    await expect(
      guard.canActivate(
        contextFor('assessment-1', { results: [{ studentId: 'student-1', score: 40 }] }),
      ),
    ).resolves.toBe(true);
  });

});
