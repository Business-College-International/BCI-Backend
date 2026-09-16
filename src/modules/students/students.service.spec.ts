import { ForbiddenException, ConflictException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { StudentsService } from './students.service';

type MockPrisma = {
  guardian: { findUnique: jest.Mock };
  student: { findUnique: jest.Mock };
  staff: { findUnique: jest.Mock };
  teacherAssignment: { findFirst: jest.Mock };
  $transaction?: jest.Mock;
};

function makePrisma(overrides: Partial<MockPrisma> = {}): MockPrisma {
  return {
    guardian: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    staff: { findUnique: jest.fn() },
    teacherAssignment: { findFirst: jest.fn() },
    ...overrides,
  };
}

function makeStudent(overrides: Record<string, unknown> = {}) {
  return {
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
    guardians: [],
    enrolments: [
      {
        id: 'enrolment-1',
        status: 'ACTIVE',
        enrolledAt: new Date('2026-09-01'),
        completedAt: null,
        classId: 'class-1',
        termId: 'term-1',
        level: 'SHS1',
        programme: 'BUSINESS',
        academicYear: { id: 'year-1', name: '2026/2027' },
        term: { id: 'term-1', code: 'TERM1', name: 'First Term' },
        class: { id: 'class-1', name: 'Business A', level: 'SHS1', programme: 'BUSINESS' },
      },
    ],
    documents: [
      { id: 'doc-1', type: 'birth_certificate', fileUrl: 'https://example.test/doc.pdf', createdAt: new Date('2026-09-01') },
    ],
    ...overrides,
  };
}

describe('StudentsService access boundaries', () => {
  it('returns only wards linked to the authenticated guardian', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue({
      wards: [
        {
          relationship: 'parent',
          isPrimaryContact: true,
          canViewAcademic: true,
          canPayFees: true,
          canManageWallet: true,
          student: makeStudent({ documents: [] }),
        },
      ],
    });

    const service = new StudentsService(prisma as never);
    const wards = await service.listMyWards('guardian-user-1');

    expect(wards).toHaveLength(1);
    expect(wards[0].student.id).toBe('student-1');
    expect(wards[0].permissions).toEqual({
      canViewAcademic: true,
      canPayFees: true,
      canManageWallet: true,
    });
  });

  it('suppresses academic data when a guardian link does not allow academic viewing', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue({
      wards: [
        {
          relationship: 'guardian',
          isPrimaryContact: false,
          canViewAcademic: false,
          canPayFees: true,
          canManageWallet: false,
          student: makeStudent(),
        },
      ],
    });

    const service = new StudentsService(prisma as never);
    const wards = await service.listMyWards('guardian-user-2');

    expect(wards[0].student).not.toHaveProperty('enrolments');
    expect(wards[0].permissions.canViewAcademic).toBe(false);
  });

  it('rejects a guardian who is not linked to the requested student', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue(
      makeStudent({
        id: 'student-2',
        guardians: [
          {
            id: 'link-1',
            relationship: 'parent',
            isPrimaryContact: true,
            canViewAcademic: true,
            canPayFees: true,
            canManageWallet: true,
            guardian: { userId: 'other-user' },
          },
        ],
      }),
    );

    const service = new StudentsService(prisma as never);

    await expect(
      service.getByActor('student-2', 'guardian-user-1', [RoleName.GUARDIAN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not expose student documents to a linked guardian', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue(
      makeStudent({
        guardians: [
          {
            id: 'link-1',
            relationship: 'parent',
            isPrimaryContact: true,
            canViewAcademic: true,
            canPayFees: true,
            canManageWallet: true,
            guardian: { userId: 'guardian-user-1' },
          },
        ],
      }),
    );

    const service = new StudentsService(prisma as never);
    const result = await service.getByActor('student-1', 'guardian-user-1', [RoleName.GUARDIAN]);

    expect(result.documents).toEqual([]);
  });

  it('allows a teacher to read a student in an assigned class', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue(makeStudent());
    prisma.staff.findUnique.mockResolvedValue({ personId: 'teacher-person-1' });
    prisma.teacherAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });

    const service = new StudentsService(prisma as never);
    await expect(
      service.getByActor('student-1', 'teacher-user-1', [RoleName.TEACHER]),
    ).resolves.toMatchObject({ student: { id: 'student-1' }, documents: [] });
  });

  it('rejects a teacher who is not assigned to the student class for the term', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue(makeStudent());
    prisma.staff.findUnique.mockResolvedValue({ personId: 'teacher-person-1' });
    prisma.teacherAssignment.findFirst.mockResolvedValue(null);

    const service = new StudentsService(prisma as never);

    await expect(
      service.getByActor('student-1', 'teacher-user-1', [RoleName.TEACHER]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows privileged office roles to read a student record with documents', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue(makeStudent());

    const service = new StudentsService(prisma as never);
    const result = await service.getByActor('student-1', 'office-user-1', [RoleName.OFFICE]);

    expect(result).toMatchObject({ student: { id: 'student-1' } });
    expect(result.documents).toHaveLength(1);
  });
});

describe('StudentsService guardian management', () => {
  it('serializes primary-guardian replacement for the same student', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', status: 'ACTIVE' }) },
      guardian: { findUnique: jest.fn().mockResolvedValue({ personId: 'guardian-1', userId: 'guardian-user-1' }) },
      guardianStudent: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'link-2',
          guardianId: 'guardian-1',
          studentId: 'student-1',
          relationship: 'parent',
          isPrimaryContact: true,
          canViewAcademic: true,
          canPayFees: true,
          canManageWallet: true,
        }),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = makePrisma({ $transaction: jest.fn(async (callback) => callback(tx)) });
    const service = new StudentsService(prisma as never);

    const result = await service.linkGuardian('student-1', 'office-user-1', {
      guardianId: 'guardian-1',
      relationship: 'parent',
      isPrimaryContact: true,
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.guardianStudent.updateMany).toHaveBeenCalledWith({
      where: { studentId: 'student-1' },
      data: { isPrimaryContact: false },
    });
    expect(result.isPrimaryContact).toBe(true);
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('does not acquire the primary lock when creating a non-primary guardian link', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', status: 'ACTIVE' }) },
      guardian: { findUnique: jest.fn().mockResolvedValue({ personId: 'guardian-1', userId: 'guardian-user-1' }) },
      guardianStudent: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'link-3',
          guardianId: 'guardian-1',
          studentId: 'student-1',
          relationship: 'guardian',
          isPrimaryContact: false,
          canViewAcademic: true,
          canPayFees: true,
          canManageWallet: true,
        }),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = makePrisma({ $transaction: jest.fn(async (callback) => callback(tx)) });
    const service = new StudentsService(prisma as never);

    await service.linkGuardian('student-1', 'office-user-1', {
      guardianId: 'guardian-1',
      relationship: 'guardian',
      isPrimaryContact: false,
    });

    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects duplicate guardian links', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', status: 'ACTIVE' }) },
      guardian: { findUnique: jest.fn().mockResolvedValue({ personId: 'guardian-1', userId: 'guardian-user-1' }) },
      guardianStudent: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing-link' }),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = makePrisma({ $transaction: jest.fn(async (callback) => callback(tx)) });
    const service = new StudentsService(prisma as never);

    await expect(service.linkGuardian('student-1', 'office-user-1', {
      guardianId: 'guardian-1',
      relationship: 'parent',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('removes a guardian link and records the previous relationship', async () => {
    const tx = {
      guardianStudent: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'link-1', guardianId: 'guardian-1', studentId: 'student-1', relationship: 'parent',
          isPrimaryContact: true, canViewAcademic: true, canPayFees: true, canManageWallet: true,
        }),
        delete: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = makePrisma({ $transaction: jest.fn(async (callback) => callback(tx)) });
    const service = new StudentsService(prisma as never);

    await expect(service.removeGuardian('student-1', 'guardian-1', 'office-user-1'))
      .resolves.toEqual({ success: true });

    expect(tx.guardianStudent.delete).toHaveBeenCalledWith({ where: { id: 'link-1' } });
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});
