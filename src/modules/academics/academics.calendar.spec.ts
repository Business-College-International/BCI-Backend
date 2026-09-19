import { ConflictException } from '@nestjs/common';
import { TermStatus } from '@prisma/client';
import { AcademicsService } from './academics.service';

describe('AcademicsService calendar controls', () => {
  it('opens a draft term and closes any other open term in the same year', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue([]),
      term: {
        findUnique: jest.fn().mockResolvedValue({ id: 'term-2', academicYearId: 'year-1', status: TermStatus.DRAFT }),
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'term-2', status: TermStatus.OPEN }),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new AcademicsService(prisma as never);

    await expect(service.transitionTerm('term-2', TermStatus.OPEN, 'office-1')).resolves.toMatchObject({ status: TermStatus.OPEN });
    expect(tx.term.updateMany).toHaveBeenCalledWith({ where: { academicYearId: 'year-1' }, data: { status: TermStatus.CLOSED } });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('rejects reopening a closed term', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue([]),
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-2', academicYearId: 'year-1', status: TermStatus.CLOSED }) },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new AcademicsService(prisma as never);

    await expect(service.transitionTerm('term-2', TermStatus.OPEN, 'office-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects reducing a class below its active enrolment population', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue([]),
      schoolClass: {
        findUnique: jest.fn().mockResolvedValue({ id: 'class-1', name: 'Business A', division: 'A', room: 'R1', capacity: 40 }),
        update: jest.fn(),
      },
      enrolment: { count: jest.fn().mockResolvedValue(35) },
      auditLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new AcademicsService(prisma as never);

    await expect(service.updateClass('class-1', { capacity: 34 }, 'office-1')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.schoolClass.update).not.toHaveBeenCalled();
  });
});
