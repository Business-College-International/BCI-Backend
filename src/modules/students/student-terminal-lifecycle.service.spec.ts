import { ConflictException } from '@nestjs/common';
import { StudentTerminalLifecycleService } from './student-terminal-lifecycle.service';

describe('StudentTerminalLifecycleService', () => {
  function makeTx(student: unknown) {
    return {
      student: {
        findUnique: jest.fn().mockResolvedValue(student),
        update: jest.fn(),
      },
      enrolment: { update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
  }

  function makePrisma(tx: ReturnType<typeof makeTx>) {
    return {
      student: { findUnique: jest.fn() },
      $transaction: async (callback: (client: unknown) => unknown) => callback(tx),
    } as never;
  }

  it('blocks graduation before the final term closes', async () => {
    const tx = makeTx({
      id: 'student-1',
      status: 'ACTIVE',
      enrolments: [{ id: 'enrolment-1', status: 'ACTIVE', level: 'SHS3', term: { status: 'OPEN' } }],
    });
    const service = new StudentTerminalLifecycleService(makePrisma(tx));
    await expect(service.graduate('student-1', 'actor-1', 'DIRECTOR' as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks graduation for non-SHS3 students', async () => {
    const tx = makeTx({
      id: 'student-1',
      status: 'ACTIVE',
      enrolments: [{ id: 'enrolment-1', status: 'ACTIVE', level: 'SHS2', term: { status: 'CLOSED' } }],
    });
    const service = new StudentTerminalLifecycleService(makePrisma(tx));
    await expect(service.graduate('student-1', 'actor-1', 'DIRECTOR' as never)).rejects.toBeInstanceOf(ConflictException);
  });
});
