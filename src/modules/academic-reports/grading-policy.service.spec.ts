import { ConflictException } from '@nestjs/common';
import { GradingPolicyStatus } from '@prisma/client';
import { GradingPolicyService } from './grading-policy.service';

function makePrisma() {
  const tx = {
    gradingPolicy: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    gradingBand: {
      deleteMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $executeRawUnsafe: jest.fn(),
  };
  return {
    prisma: {
      ...tx,
      academicYear: { findUnique: jest.fn() },
      gradingPolicy: tx.gradingPolicy,
      auditLog: tx.auditLog,
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
    tx,
  };
}

const validBands = [
  { code: 'F', lowerInclusive: '0', upperExclusive: '50', pass: false, descriptor: 'Fail', points: '0', order: 1 },
  { code: 'A', lowerInclusive: '50', pass: true, descriptor: 'Pass', points: '4', order: 2 },
];

describe('GradingPolicyService', () => {
  it('rejects gaps and overlaps before creating a policy', async () => {
    const { prisma } = makePrisma();
    prisma.academicYear.findUnique.mockResolvedValue({ id: 'year-1' });
    const service = new GradingPolicyService(prisma as never);

    await expect(service.create('user-1', {
      academicYearId: 'year-1',
      name: 'Broken',
      level: 'P1',
      bands: [
        validBands[0],
        { ...validBands[1], lowerInclusive: '51' },
      ],
    } as never)).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.gradingPolicy.create).not.toHaveBeenCalled();
  });

  it('creates a draft policy and records the audit event', async () => {
    const { prisma } = makePrisma();
    prisma.academicYear.findUnique.mockResolvedValue({ id: 'year-1' });
    prisma.gradingPolicy.create.mockResolvedValue({
      id: 'policy-1',
      version: 'GRADING-2026-TEST',
      name: 'Primary policy',
      academicYearId: 'year-1',
      level: 'P1',
      programme: null,
      status: GradingPolicyStatus.DRAFT,
      bands: validBands,
    });

    const service = new GradingPolicyService(prisma as never);
    const result = await service.create('user-1', {
      academicYearId: 'year-1',
      name: 'Primary policy',
      level: 'P1',
      programme: null,
      bands: validBands,
    } as never);

    expect(result).toMatchObject({ id: 'policy-1', status: GradingPolicyStatus.DRAFT });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('refuses to publish when another active policy occupies the same scope', async () => {
    const { prisma, tx } = makePrisma();
    tx.gradingPolicy.findUnique.mockResolvedValue({
      id: 'policy-2',
      version: 'GRADING-2026-2',
      status: GradingPolicyStatus.DRAFT,
      academicYearId: 'year-1',
      level: 'P1',
      programme: null,
      bands: validBands.map((band) => ({
        ...band,
        lowerInclusive: { toString: () => band.lowerInclusive },
        upperExclusive: band.upperExclusive ? { toString: () => band.upperExclusive } : null,
        points: { toString: () => band.points },
      })),
    });
    tx.gradingPolicy.findFirst.mockResolvedValue({ id: 'active-1', version: 'GRADING-2026-1' });

    const service = new GradingPolicyService(prisma as never);
    await expect(service.publish('policy-2', 'user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.gradingPolicy.update).not.toHaveBeenCalled();
  });
});
