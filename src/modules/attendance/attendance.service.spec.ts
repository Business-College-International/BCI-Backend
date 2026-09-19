import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AttendanceStatus, RoleName } from '@prisma/client';
import { AttendanceService } from './attendance.service';

function makePrisma() {
  return {
    student: { findUnique: jest.fn() },
    guardian: { findUnique: jest.fn() },
    guardianStudent: { findUnique: jest.fn() },
    enrolment: { findFirst: jest.fn() },
    staff: { findUnique: jest.fn() },
    teacherAssignment: { findFirst: jest.fn() },
    attendanceSession: { findMany: jest.fn() },
    $transaction: jest.fn(),
  } as any;
}

describe('AttendanceService access and integrity', () => {
  it('rejects a teacher who is not assigned to create a session', async () => {
    const prisma = makePrisma();
    const tx = {
      term: { findUnique: jest.fn() },
      schoolClass: { findUnique: jest.fn() },
      staff: { findUnique: jest.fn() },
      teacherAssignment: { findFirst: jest.fn() },
      subject: { findUnique: jest.fn() },
      attendanceSession: { findFirst: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'class-1' }]),
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.term.findUnique.mockResolvedValue({
      academicYearId: 'year-1',
      startsAt: new Date('2026-09-01'),
      endsAt: new Date('2026-12-31'),
      status: 'OPEN',
    });
    tx.schoolClass.findUnique.mockResolvedValue({ academicYearId: 'year-1', level: 'SHS1' });
    tx.staff.findUnique.mockResolvedValue({ personId: 'teacher-1' });
    tx.teacherAssignment.findFirst.mockResolvedValue(null);

    const service = new AttendanceService(prisma);

    await expect(service.createSession({
      termId: 'term-1',
      classId: 'class-1',
      sessionDate: '2026-10-01T08:00:00.000Z',
    }, 'teacher-user-1', [RoleName.TEACHER])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a duplicate session for the same class, subject, date, and period', async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'class-1' }]),
      term: { findUnique: jest.fn().mockResolvedValue({
        academicYearId: 'year-1',
        startsAt: new Date('2026-09-01'),
        endsAt: new Date('2026-12-31'),
        status: 'OPEN',
      }) },
      schoolClass: { findUnique: jest.fn().mockResolvedValue({ academicYearId: 'year-1', level: 'SHS1' }) },
      staff: { findUnique: jest.fn().mockResolvedValue({ personId: 'teacher-1' }) },
      teacherAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'assignment-1' }) },
      attendanceSession: { findFirst: jest.fn().mockResolvedValue({ id: 'existing-session' }), create: jest.fn() },
      subject: { findUnique: jest.fn().mockResolvedValue({ id: 'subject-1', level: 'SHS1' }) },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const service = new AttendanceService(prisma);

    await expect(service.createSession({
      termId: 'term-1',
      classId: 'class-1',
      subjectId: 'subject-1',
      sessionDate: '2026-10-01T08:00:00.000Z',
      periodLabel: 'Period 3',
    }, 'teacher-user-1', [RoleName.TEACHER])).rejects.toBeInstanceOf(ConflictException);

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.attendanceSession.create).not.toHaveBeenCalled();
  });

  it('rejects marking a student outside the session class and term', async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'session-1' }]),
      attendanceSession: { findUnique: jest.fn() },
      staff: { findUnique: jest.fn() },
      teacherAssignment: { findFirst: jest.fn() },
      enrolment: { findMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.attendanceSession.findUnique.mockResolvedValue({
      id: 'session-1',
      classId: 'class-1',
      termId: 'term-1',
      subjectId: null,
      term: { status: 'OPEN' },
    });
    tx.staff.findUnique.mockResolvedValue({ personId: 'teacher-1' });
    tx.teacherAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
    tx.enrolment.findMany.mockResolvedValue([]);

    const service = new AttendanceService(prisma);

    await expect(service.markAttendance('session-1', {
      records: [{ studentId: 'student-1', status: AttendanceStatus.PRESENT }],
    }, 'teacher-user-1', [RoleName.TEACHER])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks attendance changes after the term is closed', async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'session-1' }]),
      attendanceSession: { findUnique: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.attendanceSession.findUnique.mockResolvedValue({
      id: 'session-1',
      classId: 'class-1',
      termId: 'term-1',
      subjectId: null,
      term: { status: 'CLOSED' },
    });

    const service = new AttendanceService(prisma);

    await expect(service.markAttendance('session-1', {
      records: [{ studentId: 'student-1', status: AttendanceStatus.PRESENT }],
    }, 'teacher-user-1', [RoleName.TEACHER])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('locks the attendance session before applying records', async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'session-1' }]),
      attendanceSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          classId: 'class-1',
          termId: 'term-1',
          subjectId: null,
          term: { status: 'OPEN' },
        }),
      },
      staff: { findUnique: jest.fn().mockResolvedValue({ personId: 'teacher-1' }) },
      teacherAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'assignment-1' }) },
      enrolment: { findMany: jest.fn().mockResolvedValue([{ studentId: 'student-1' }]) },
      attendanceRecord: {
        upsert: jest.fn().mockResolvedValue({ id: 'record-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));

    const service = new AttendanceService(prisma);

    await service.markAttendance('session-1', {
      records: [{ studentId: 'student-1', status: AttendanceStatus.PRESENT }],
    }, 'teacher-user-1', [RoleName.TEACHER]);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.attendanceRecord.upsert).toHaveBeenCalledTimes(1);
  });

  it('denies a guardian who lacks academic visibility', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-person-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canViewAcademic: false });

    const service = new AttendanceService(prisma);

    await expect(
      service.getStudentAttendance('student-1', 'guardian-user-1', [RoleName.GUARDIAN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a teacher requesting attendance for a term where they are not assigned', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.guardian.findUnique.mockResolvedValue(null);
    prisma.staff.findUnique.mockResolvedValue({ personId: 'teacher-1' });
    prisma.enrolment.findFirst.mockResolvedValue(null);

    const service = new AttendanceService(prisma);

    await expect(
      service.getStudentAttendance('student-1', 'teacher-user-1', [RoleName.TEACHER], 'historical-term-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.enrolment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: 'student-1', status: 'ACTIVE', termId: 'historical-term-1' },
    }));
    expect(prisma.attendanceSession.findMany).not.toHaveBeenCalled();
  });

  it('allows privileged school roles to read attendance', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.attendanceSession.findMany.mockResolvedValue([]);

    const service = new AttendanceService(prisma);

    await expect(
      service.getStudentAttendance('student-1', 'principal-user-1', [RoleName.PRINCIPAL]),
    ).resolves.toMatchObject({ summary: { total: 0 }, sessions: [] });
  });
});
