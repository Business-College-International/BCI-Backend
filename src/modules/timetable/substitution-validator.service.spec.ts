import { SubstitutionValidatorService } from './substitution-validator.service';

describe('SubstitutionValidatorService', () => {
  const prisma = {
    teacherAssignment: { findFirst: jest.fn() },
    staff: { findUnique: jest.fn(), findMany: jest.fn() },
  } as any;
  const service = new SubstitutionValidatorService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('rejects the original teacher being used as substitute', async () => {
    const result = await service.validate({ termId: 'term', originalStaffId: 'staff-1', substituteStaffId: 'staff-1', classId: 'class', subjectId: 'subject', dayOfWeek: 1, startsAt: '2026-09-16T08:00:00.000Z', endsAt: '2026-09-16T09:00:00.000Z' });
    expect(result.reasons).toContain('SUBSTITUTE_SAME_AS_ORIGINAL');
  });

  it('requires the original assignment to exist', async () => {
    prisma.teacherAssignment.findFirst.mockResolvedValue(null);
    prisma.staff.findUnique
      .mockResolvedValueOnce({ personId: 'sub', employmentStatus: 'active' })
      .mockResolvedValueOnce({ personId: 'orig', employmentStatus: 'active' });
    prisma.teacherAssignment.findMany = jest.fn().mockResolvedValue([]);
    prisma.staff.findMany.mockResolvedValue([]);

    const result = await service.validate({ termId: 'term', originalStaffId: 'orig', substituteStaffId: 'sub', classId: 'class', subjectId: 'subject', dayOfWeek: 1, startsAt: '2026-09-16T08:00:00.000Z', endsAt: '2026-09-16T09:00:00.000Z' });
    expect(result.reasons).toContain('ORIGINAL_ASSIGNMENT_NOT_FOUND');
  });

  it('rejects inactive substitutes', async () => {
    prisma.teacherAssignment.findFirst.mockResolvedValue({ id: 'assignment' });
    prisma.staff.findUnique
      .mockResolvedValueOnce({ personId: 'sub', employmentStatus: 'suspended' })
      .mockResolvedValueOnce({ personId: 'orig', employmentStatus: 'active' });
    prisma.teacherAssignment.findMany.mockResolvedValue([]);

    const result = await service.validate({ termId: 'term', originalStaffId: 'orig', substituteStaffId: 'sub', classId: 'class', subjectId: 'subject', dayOfWeek: 1, startsAt: '2026-09-16T08:00:00.000Z', endsAt: '2026-09-16T09:00:00.000Z' });
    expect(result.reasons).toContain('SUBSTITUTE_NOT_ACTIVE');
  });
});
