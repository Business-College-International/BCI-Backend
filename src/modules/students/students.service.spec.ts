import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { StudentsService } from './students.service';

type MockPrisma = {
  guardian: { findUnique: jest.Mock };
  student: { findUnique: jest.Mock };
  staff: { findUnique: jest.Mock };
  teacherAssignment: { findFirst: jest.Mock };
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
          student: makeStudent({ documents: [] }),
        },
      ],
    });

    const service = new StudentsService(prisma as never);
    const wards = await service.listMyWards('guardian-user-1');

    expect(prisma.guardian.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'guardian-user-1' } }),
    );
    expect(wards).toHaveLength(1);
    expect(wards[0].student.id).toBe('student-1');
  });

  it('rejects a guardian who is not linked to the requested student', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue(
      makeStudent({
        id: 'student-2',
        guardians: [
          { relationship: 'parent', isPrimaryContact: true, guardian: { userId: 'other-user' } },
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
          { relationship: 'parent', isPrimaryContact: true, guardian: { userId: 'guardian-user-1' } },
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

    expect(prisma.teacherAssignment.findFirst).toHaveBeenCalledWith({
      where: { staffId: 'teacher-person-1', classId: 'class-1', termId: 'term-1' },
      select: { id: true },
    });
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
