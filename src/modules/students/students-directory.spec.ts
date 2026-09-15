import { ForbiddenException } from '@nestjs/common';
import { RoleName, StudentStatus } from '@prisma/client';
import { StudentsService } from './students.service';

describe('StudentsService.listDirectory', () => {
  it('blocks non-staff directory access', async () => {
    const prisma = {
      staff: { findUnique: jest.fn() },
    };
    const service = new StudentsService(prisma as never);

    await expect(
      service.listDirectory('guardian-user', [RoleName.GUARDIAN], {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns an empty teacher directory when no assignments exist', async () => {
    const prisma = {
      staff: { findUnique: jest.fn().mockResolvedValue({ personId: 'staff-1' }) },
      teacherAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new StudentsService(prisma as never);

    await expect(
      service.listDirectory('teacher-user', [RoleName.TEACHER], {}),
    ).resolves.toEqual([]);
  });

  it('uses the requested filters and bounded result set for privileged staff', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { student: { findMany } };
    const service = new StudentsService(prisma as never);

    await service.listDirectory('office-user', [RoleName.OFFICE], {
      status: StudentStatus.ACTIVE,
      q: 'BCI/SHS/001',
      termId: 'term-1',
      classId: 'class-1',
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      status: StudentStatus.ACTIVE,
      enrolments: {
        some: expect.objectContaining({ termId: 'term-1', classId: 'class-1' }),
      },
    });
  });
});
