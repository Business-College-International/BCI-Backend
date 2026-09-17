import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  function makePrisma(tx: ReturnType<typeof makeTx>, transactionError?: unknown) {
    return {
      student: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: (client: unknown) => unknown, options: unknown) => {
        if (transactionError) throw transactionError;
        expect(options).toEqual(expect.objectContaining({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }));
        return callback(tx);
      }),
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

  it('translates a concurrent graduation into a retryable conflict', async () => {
    const prisma = makePrisma(makeTx({}), { code: 'P2034' });
    const service = new StudentTerminalLifecycleService(prisma);
    await expect(service.graduate('student-1', 'actor-1', 'DIRECTOR' as never))
      .rejects.toEqual(expect.objectContaining({ message: 'Student lifecycle changed concurrently. Please retry the operation.' }));
  });

  it('translates a concurrent transfer into a retryable conflict', async () => {
    const prisma = makePrisma(makeTx({}), { code: 'P2034' });
    const service = new StudentTerminalLifecycleService(prisma);
    await expect(service.transfer('student-1', 'actor-1', ['DIRECTOR'] as never, {
      destinationSchool: 'Other School',
      reason: 'Family relocation',
    } as any)).rejects.toEqual(expect.objectContaining({ message: 'Student lifecycle changed concurrently. Please retry the operation.' }));
  });
});
