import { BadRequestException } from '@nestjs/common';
import { AssessmentWriteGuard } from './assessment-write.guard';

function contextFor(assessmentId = 'assessment-1') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params: { assessmentId } }),
    }),
  } as any;
}

describe('AssessmentWriteGuard', () => {
  it('allows result writes while the term is open', async () => {
    const prisma = {
      assessment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'assessment-1', term: { status: 'OPEN' } }),
      },
    };
    const guard = new AssessmentWriteGuard(prisma as never);
    await expect(guard.canActivate(contextFor())).resolves.toBe(true);
  });

  it('rejects result writes after the term is closed', async () => {
    const prisma = {
      assessment: {
        findUnique: jest.fn().mockResolvedValue({ id: 'assessment-1', term: { status: 'CLOSED' } }),
      },
    };
    const guard = new AssessmentWriteGuard(prisma as never);
    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(BadRequestException);
  });
});
