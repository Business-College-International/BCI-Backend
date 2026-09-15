import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { AcademicsService } from './academics.service';

type MockPrisma = {
  staff: { findUnique: jest.Mock };
  teacherAssignment: { findMany: jest.Mock };
  schoolClass: { findMany: jest.Mock };
};

function makePrisma(): MockPrisma {
  return {
    staff: { findUnique: jest.fn() },
    teacherAssignment: { findMany: jest.fn() },
    schoolClass: { findMany: jest.fn() },
  };
}

describe('AcademicsService class scope', () => {
  it('limits teacher class reads to assigned classes', async () => {
    const prisma = makePrisma();
    prisma.staff.findUnique.mockResolvedValue({ personId: 'teacher-person-1' });
    prisma.teacherAssignment.findMany.mockResolvedValue([
      { classId: 'class-1' },
      { classId: 'class-2' },
      { classId: 'class-1' },
    ]);
    prisma.schoolClass.findMany.mockResolvedValue([
      { id: 'class-1', name: 'Business A' },
      { id: 'class-2', name: 'Business B' },
    ]);

    const service = new AcademicsService(prisma as never);
    const result = await service.listClasses('year-1', 'teacher-user-1', [RoleName.TEACHER]);

    expect(prisma.teacherAssignment.findMany).toHaveBeenCalledWith({
      where: { staffId: 'teacher-person-1', class: { academicYearId: 'year-1' } },
      select: { classId: true },
      distinct: ['classId'],
    });
    expect(prisma.schoolClass.findMany).toHaveBeenCalledWith({
      where: { academicYearId: 'year-1', id: { in: ['class-1', 'class-2', 'class-1'] } },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
    });
    expect(result).toHaveLength(2);
  });

  it('rejects teachers without a staff link', async () => {
    const prisma = makePrisma();
    prisma.staff.findUnique.mockResolvedValue(null);

    const service = new AcademicsService(prisma as never);

    await expect(
      service.listClasses(undefined, 'teacher-user-1', [RoleName.TEACHER]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose classes to unrelated non-privileged roles', async () => {
    const prisma = makePrisma();
    const service = new AcademicsService(prisma as never);

    const result = await service.listClasses(undefined, 'guardian-user-1', [RoleName.GUARDIAN]);

    expect(result).toEqual([]);
    expect(prisma.schoolClass.findMany).not.toHaveBeenCalled();
  });
});
