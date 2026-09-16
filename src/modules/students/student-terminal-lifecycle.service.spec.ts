import { ConflictException } from '@nestjs/common';
import { StudentTerminalLifecycleService } from './student-terminal-lifecycle.service';

describe('StudentTerminalLifecycleService', () => {
  it('blocks graduation before the final term closes', async () => {
    const prisma = {
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1', status: 'ACTIVE',
          enrolments: [{ id: 'enrolment-1', status: 'ACTIVE', level: 'SHS3', termId: 'term-1', term: { status: 'OPEN' } }],
        }),
      },
      $transaction: jest.fn(),
    } as any;
    const service = new StudentTerminalLifecycleService(prisma);
    await expect(service.graduate('student-1', 'actor-1', 'DIRECTOR' as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks graduation for non-SHS3 students', async () => {
    const prisma = {
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1', status: 'ACTIVE',
          enrolments: [{ id: 'enrolment-1', status: 'ACTIVE', level: 'SHS2', term: { status: 'CLOSED' } }],
        }),
      },
      $transaction: jest.fn(),
    } as any;
    const service = new StudentTerminalLifecycleService(prisma);
    await expect(service.graduate('student-1', 'actor-1', 'DIRECTOR' as any)).rejects.toBeInstanceOf(ConflictException);
  });
});
