import { ConflictException } from '@nestjs/common';
import { StudentLifecycleService } from './student-lifecycle.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    $transaction: async (callback: (tx: any) => unknown) => callback(overrides),
  };
}

describe('StudentLifecycleService', () => {
  it('rejects progression into a full target class', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue([]),
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1',
          status: 'ACTIVE',
          enrolments: [{
            id: 'enrol-1',
            termId: 'term-1',
            classId: 'class-1',
            level: 'SHS1',
            programme: 'BUSINESS',
            enrolledAt: new Date('2026-01-01'),
            term: { endsAt: new Date('2026-07-31') },
          }],
        }),
      },
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-2', academicYearId: 'year-1', startsAt: new Date('2026-09-01'), academicYear: {} }) },
      schoolClass: { findUnique: jest.fn().mockResolvedValue({ id: 'class-2', academicYearId: 'year-1', level: 'SHS2', programme: 'BUSINESS', capacity: 1 }) },
      enrolment: {
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };

    const service = new StudentLifecycleService(makePrisma({ ...tx }) as never);
    await expect(service.progressStudent('student-1', 'actor-1', {
      targetTermId: 'term-2',
      targetClassId: 'class-2',
      targetLevel: 'SHS2' as any,
      targetProgramme: 'BUSINESS' as any,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('locks the student and destination class before checking capacity', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue([]),
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1',
          status: 'ACTIVE',
          enrolments: [{
            id: 'enrol-1',
            termId: 'term-1',
            classId: 'class-1',
            level: 'SHS1',
            programme: 'BUSINESS',
            enrolledAt: new Date('2026-01-01'),
            term: { endsAt: new Date('2026-07-31') },
          }],
        }),
      },
      term: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'term-2',
          academicYearId: 'year-1',
          startsAt: new Date('2026-09-01'),
          academicYear: {},
        }),
      },
      schoolClass: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'class-2',
          academicYearId: 'year-1',
          level: 'SHS2',
          programme: 'BUSINESS',
          capacity: null,
        }),
      },
      enrolment: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'enrol-new' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new StudentLifecycleService(prisma as never);

    await service.progressStudent('student-1', 'actor-1', {
      targetTermId: 'term-2',
      targetClassId: 'class-2',
      targetLevel: 'SHS2' as any,
      targetProgramme: 'BUSINESS' as any,
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.student.findUnique).toHaveBeenCalled();
    expect(tx.schoolClass.findUnique).toHaveBeenCalled();
  });


  it('rejects elective assignment into a closed term', async () => {
    const tx = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', status: 'ACTIVE' }) },
      enrolment: { findFirst: jest.fn().mockResolvedValue({ id: 'enrol-1', level: 'SHS1', programme: 'BUSINESS' }) },
      subject: { findUnique: jest.fn().mockResolvedValue({ id: 'subject-1', isActive: true, isElective: true, level: 'SHS1', programme: 'BUSINESS' }) },
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', status: 'CLOSED' }) },
      studentElective: { findFirst: jest.fn(), create: jest.fn() },
      auditLog: { create: jest.fn() },
    };

    const service = new StudentLifecycleService(makePrisma({ ...tx }) as never);
    await expect(service.assignElective('student-1', 'actor-1', { termId: 'term-1', subjectId: 'subject-1' }))
      .rejects.toThrow('cannot be changed after the term is closed');
    expect(tx.studentElective.create).not.toHaveBeenCalled();
  });

  it('rejects elective removal from a closed term', async () => {
    const tx = {
      enrolment: { findFirst: jest.fn().mockResolvedValue({ id: 'enrol-1', status: 'ACTIVE' }) },
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', status: 'CLOSED' }) },
      studentElective: { findFirst: jest.fn(), delete: jest.fn() },
      auditLog: { create: jest.fn() },
    };

    const service = new StudentLifecycleService(makePrisma({ ...tx }) as never);
    await expect(service.removeElective('student-1', 'subject-1', 'term-1', 'actor-1'))
      .rejects.toThrow('cannot be changed after the term is closed');
    expect(tx.studentElective.delete).not.toHaveBeenCalled();
  });

  it('rejects elective removal when the term enrolment is no longer active', async () => {
    const tx = {
      enrolment: { findFirst: jest.fn().mockResolvedValue({ id: 'enrol-1', status: 'COMPLETED' }) },
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', status: 'OPEN' }) },
      studentElective: { findFirst: jest.fn(), delete: jest.fn() },
      auditLog: { create: jest.fn() },
    };

    const service = new StudentLifecycleService(makePrisma({ ...tx }) as never);
    await expect(service.removeElective('student-1', 'subject-1', 'term-1', 'actor-1'))
      .rejects.toThrow('cannot be changed without an active enrolment');
    expect(tx.studentElective.delete).not.toHaveBeenCalled();
  });

  it('rejects duplicate elective assignment', async () => {
    const tx = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', status: 'ACTIVE' }) },
      enrolment: { findFirst: jest.fn().mockResolvedValue({ id: 'enrol-1', level: 'SHS1', programme: 'BUSINESS' }) },
      subject: { findUnique: jest.fn().mockResolvedValue({ id: 'subject-1', isActive: true, isElective: true, level: 'SHS1', programme: 'BUSINESS' }) },
      studentElective: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }), create: jest.fn() },
      auditLog: { create: jest.fn() },
    };

    const service = new StudentLifecycleService(makePrisma({ ...tx }) as never);
    await expect(service.assignElective('student-1', 'actor-1', { termId: 'term-1', subjectId: 'subject-1' }))
      .rejects.toThrow('already assigned');
  });
});
