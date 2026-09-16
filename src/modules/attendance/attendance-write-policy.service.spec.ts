import { BadRequestException } from '@nestjs/common';
import { AttendanceWritePolicyService } from './attendance-write-policy.service';

describe('AttendanceWritePolicyService', () => {
  const makePrisma = (status: string | null) => ({
    term: { findUnique: jest.fn().mockResolvedValue(status ? { status } : null) },
  });

  it('rejects writes when the term is closed', async () => {
    const prisma = makePrisma('CLOSED');
    const service = new AttendanceWritePolicyService();
    await expect(service.assertSessionWritable(prisma as never, 'term-1', null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects writes when the session is finalized', async () => {
    const prisma = makePrisma('OPEN');
    const service = new AttendanceWritePolicyService();
    await expect(service.assertSessionWritable(prisma as never, 'term-1', new Date())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows writes for an open, unfinalized session', async () => {
    const prisma = makePrisma('OPEN');
    const service = new AttendanceWritePolicyService();
    await expect(service.assertSessionWritable(prisma as never, 'term-1', null)).resolves.toBeUndefined();
  });

  it('rejects an unknown term', async () => {
    const prisma = makePrisma(null);
    const service = new AttendanceWritePolicyService();
    await expect(service.assertSessionWritable(prisma as never, 'missing', null)).rejects.toBeInstanceOf(BadRequestException);
  });
});
