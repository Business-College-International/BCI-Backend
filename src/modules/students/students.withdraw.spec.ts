import { ConflictException } from '@nestjs/common';
import { StudentStatus } from '@prisma/client';
import { StudentsService } from './students.service';

type MockPrisma = {
  $transaction: jest.Mock;
};

function makePrisma(student: any): MockPrisma {
  return {
    $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
      student: {
        findUnique: jest.fn().mockResolvedValue(student),
        update: jest.fn().mockResolvedValue({ id: student.id, status: StudentStatus.WITHDRAWN }),
      },
      enrolment: {
        update: jest.fn().mockResolvedValue({
          id: 'enrolment-1',
          status: 'WITHDRAWN',
          completedAt: new Date('2026-09-15'),
          exitReason: 'Family relocation',
        }),
      },
      auditLog: { create: jest.fn() },
    })),
  };
}

describe('StudentsService withdrawal lifecycle', () => {
  it('withdraws the active enrolment and student atomically', async () => {
    const prisma = makePrisma({
      id: 'student-1',
      status: StudentStatus.ACTIVE,
      enrolments: [{ id: 'enrolment-1', status: 'ACTIVE' }],
    });

    const service = new StudentsService(prisma as never);
    const result = await service.withdraw('student-1', 'office-user-1', { reason: 'Family relocation' });

    expect(result.student.status).toBe(StudentStatus.WITHDRAWN);
    expect(result.enrolment.status).toBe('WITHDRAWN');
    expect(result.enrolment.exitReason).toBe('Family relocation');
  });

  it('rejects withdrawal when the student is no longer active', async () => {
    const prisma = makePrisma({
      id: 'student-2',
      status: StudentStatus.WITHDRAWN,
      enrolments: [],
    });

    const service = new StudentsService(prisma as never);

    await expect(
      service.withdraw('student-2', 'office-user-1', { reason: 'Duplicate request' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
