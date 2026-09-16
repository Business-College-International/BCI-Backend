import { BadRequestException, ConflictException } from '@nestjs/common';
import { TermLifecycleService } from './term-lifecycle.service';

function makePrisma(tx: any) {
  return { $transaction: async (callback: (client: any) => unknown) => callback(tx) };
}

describe('TermLifecycleService', () => {
  it('rejects overlapping term dates', async () => {
    const tx = {
      academicYear: { findUnique: jest.fn().mockResolvedValue({ id: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2027-08-31') }) },
      term: { findFirst: jest.fn().mockResolvedValue({ id: 'term-1', code: 'T1' }) },
    };
    const service = new TermLifecycleService(makePrisma(tx) as never);
    await expect(service.createTerm('year-1', { code: 'T2', name: 'Term 2', startsAt: '2027-01-01', endsAt: '2027-03-31', status: 'DRAFT' } as any, 'actor-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not close draft terms when opening another term', async () => {
    const tx = {
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
});
