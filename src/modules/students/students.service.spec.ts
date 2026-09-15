import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { StudentsService } from './students.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    guardian: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    ...overrides,
  } as never;
}

describe('StudentsService access boundaries', () => {
  it('returns only wards linked to the authenticated guardian', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue({
      wards: [
        {
          relationship: 'parent',
          isPrimaryContact: true,
          student: {
            id: 'student-1',
            admissionNumber: 'BCI-001',
            firstName: 'Ama',
            lastName: 'Doe',
            dateOfBirth: new Date('2010-01-01'),
            sex: 'F',
            hometown: null,
            region: null,
            passportPhotoUrl: null,
            previousSchool: null,
            status: 'ACTIVE',
            admittedAt: new Date('2026-09-01'),
          },
        },
      ],
    });

    const service = new StudentsService(prisma);
    const wards = await service.listMyWards('guardian-user-1');

    expect(prisma.guardian.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'guardian-user-1' } }),
    );
    expect(wards).toHaveLength(1);
    expect(wards[0].student.id).toBe('student-1');
  });

  it('rejects a guardian who is not linked to the requested student', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue({
      id: 'student-2',
      admissionNumber: null,
      firstName: 'Kojo',
      lastName: 'Doe',
      dateOfBirth: new Date('2010-01-01'),
      sex: 'M',
      hometown: null,
      region: null,
      passportPhotoUrl: null,
      previousSchool: null,
      status: 'ACTIVE',
      admittedAt: null,
      guardians: [
        { relationship: 'parent', isPrimaryContact: true, guardian: { userId: 'other-user' } },
      ],
      enrolments: [],
      documents: [],
    });

    const service = new StudentsService(prisma);

    await expect(
      service.getByActor('student-2', 'guardian-user-1', [RoleName.GUARDIAN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows privileged office roles to read a student record', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue({
      id: 'student-3',
      admissionNumber: 'BCI-003',
      firstName: 'Yaw',
      lastName: 'Doe',
      dateOfBirth: new Date('2010-01-01'),
      sex: 'M',
      hometown: null,
      region: null,
      passportPhotoUrl: null,
      previousSchool: null,
      status: 'ACTIVE',
      admittedAt: null,
      guardians: [],
      enrolments: [],
      documents: [],
    });

    const service = new StudentsService(prisma);
    await expect(
      service.getByActor('student-3', 'office-user-1', [RoleName.OFFICE]),
    ).resolves.toMatchObject({ student: { id: 'student-3' } });
  });
});
