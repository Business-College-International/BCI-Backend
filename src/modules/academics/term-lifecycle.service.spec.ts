import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TermLifecycleService } from './term-lifecycle.service';

function makePrisma(tx: any, transactionError?: unknown) {
  return {
    $transaction: jest.fn(async (callback: (client: any) => unknown, options: unknown) => {
      if (transactionError) throw transactionError;
      expect(options).toEqual(expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }));
      return callback(tx);
    }),
  };
}

describe('TermLifecycleService', () => {
  it('rejects overlapping term dates', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'year-1' }]),
      academicYear: { findUnique: jest.fn().mockResolvedValue({ id: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2027-08-31') }) },
      term: { findFirst: jest.fn().mockResolvedValue({ id: 'term-1', code: 'T1' }) },
    };
    const service = new TermLifecycleService(makePrisma(tx) as never);
    await expect(service.createTerm('year-1', { code: 'T2', name: 'Term 2', startsAt: '2027-01-01', endsAt: '2027-03-31', status: 'DRAFT' } as any, 'actor-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not close draft terms when opening another term', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'term-2' }]),
      term: {
        findUnique: jest.fn().mockResolvedValue({ id: 'term-2', academicYearId: 'year-1', status: 'DRAFT' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'term-2', status: 'OPEN' }),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new TermLifecycleService(makePrisma(tx) as never);
    await service.transitionTerm('term-2', 'OPEN' as any, 'actor-1');
    expect(tx.term.updateMany).toHaveBeenCalledWith({ where: { academicYearId: 'year-1', status: 'OPEN' }, data: { status: 'CLOSED' } });
  });

  it('locks the academic year before creating a term', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'year-1' }]),
      academicYear: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'year-1',
          startsAt: new Date('2026-09-01'),
          endsAt: new Date('2027-08-31'),
        }),
      },
      term: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'term-new',
          code: 'T2',
          name: 'Term 2',
          startsAt: new Date('2027-01-01'),
          endsAt: new Date('2027-03-31'),
          status: 'DRAFT',
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new TermLifecycleService(makePrisma(tx) as never);

    await service.createTerm('year-1', {
      code: 'T2',
      name: 'Term 2',
      startsAt: '2027-01-01',
      endsAt: '2027-03-31',
      status: 'DRAFT',
    } as any, 'actor-1');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.term.create).toHaveBeenCalled();
  });

  it('locks the academic year and term before transitioning a term', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'term-2' }]),
      term: {
        findUnique: jest.fn().mockResolvedValue({ id: 'term-2', academicYearId: 'year-1', status: 'DRAFT' }),
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'term-2', status: 'OPEN' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new TermLifecycleService(makePrisma(tx) as never);

    await service.transitionTerm('term-2', 'OPEN' as any, 'actor-1');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.term.updateMany).toHaveBeenCalled();
  });

  it('rejects invalid state transitions', async () => {
    const tx = { term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', status: 'CLOSED', academicYearId: 'year-1' }) } };
    const service = new TermLifecycleService(makePrisma(tx) as never);
    await expect(service.transitionTerm('term-1', 'OPEN' as any, 'actor-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects term dates outside the academic year', async () => {
    const tx = { academicYear: { findUnique: jest.fn().mockResolvedValue({ id: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2027-08-31') }) } };
    const service = new TermLifecycleService(makePrisma(tx) as never);
    await expect(service.createTerm('year-1', { code: 'T1', name: 'Term 1', startsAt: '2026-08-01', endsAt: '2026-12-01', status: 'DRAFT' } as any, 'actor-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('translates a serialization conflict during term creation into a retryable conflict', async () => {
    const prisma = makePrisma({}, { code: 'P2034' });
    const service = new TermLifecycleService(prisma as never);
    await expect(
      service.createTerm('year-1', { code: 'T1', name: 'Term 1', startsAt: '2026-09-01', endsAt: '2026-12-01', status: 'OPEN' } as any, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('translates a serialization conflict during term transition into a retryable conflict', async () => {
    const prisma = makePrisma({}, { code: 'P2034' });
    const service = new TermLifecycleService(prisma as never);
    await expect(service.transitionTerm('term-1', 'OPEN' as any, 'actor-1'))
      .rejects.toBeInstanceOf(ConflictException);
  });
});
