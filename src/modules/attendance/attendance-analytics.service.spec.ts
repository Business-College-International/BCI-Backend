import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttendanceAnalyticsService } from './attendance-analytics.service';
import { RoleName } from '@prisma/client';

function makePrisma() {
  return {
    schoolClass: { findUnique: jest.fn() },
    term: { findUnique: jest.fn() },
    staff: { findUnique: jest.fn() },
    teacherAssignment: { findFirst: jest.fn() },
    enrolment: { findMany: jest.fn() },
    attendanceSession: { findMany: jest.fn() },
    attendanceRecord: { findMany: jest.fn() },
  };
}

describe('AttendanceAnalyticsService', () => {
  it('rejects a teacher who is not assigned to the class and term', async () => {
    const prisma = makePrisma();
    prisma.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', academicYearId: 'year-1' });
    prisma.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1' });
    prisma.staff.findUnique.mockResolvedValue({ personId: 'teacher-1' });
    prisma.teacherAssignment.findFirst.mockResolvedValue(null);

    const service = new AttendanceAnalyticsService(prisma as never);

    await expect(
      service.getClassSummary('class-1', 'term-1', 'teacher-user-1', [RoleName.TEACHER]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects invalid chronic-absence policy values', async () => {
    const prisma = makePrisma();
    const service = new AttendanceAnalyticsService(prisma as never);

    await expect(
      service.getChronicAbsence('class-1', 'term-1', 'office-1', [RoleName.OFFICE], 1, 5),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calculates class attendance rates and chronic absence flags', async () => {
    const prisma = makePrisma();
    prisma.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', academicYearId: 'year-1', name: 'Business A', level: 'SHS2', programme: 'BUSINESS' });
    prisma.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1', code: 'T1', name: 'First Term', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-20') });
    prisma.enrolment.findMany.mockResolvedValue([
      { studentId: 'student-1', student: { id: 'student-1', admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Doe' } },
      { studentId: 'student-2', student: { id: 'student-2', admissionNumber: 'BCI-002', firstName: 'Kojo', lastName: 'Doe' } },
    ]);
    prisma.attendanceSession.findMany.mockResolvedValue([
      { id: 'session-1', sessionDate: new Date('2026-09-10'), subjectId: 'subject-1', subject: { code: 'MAT', name: 'Mathematics' } },
      { id: 'session-2', sessionDate: new Date('2026-09-11'), subjectId: 'ENG', subject: { code: 'ENG', name: 'English' } },
      { id: 'session-3', sessionDate: new Date('2026-09-12'), subjectId: 'SCI', subject: { code: 'SCI', name: 'Science' } },
      { id: 'session-4', sessionDate: new Date('2026-09-13'), subjectId: 'BUS', subject: { code: 'BUS', name: 'Business' } },
      { id: 'session-5', sessionDate: new Date('2026-09-14'), subjectId: 'GOV', subject: { code: 'GOV', name: 'Government' } },
    ]);
    prisma.attendanceRecord.findMany.mockResolvedValue([
      { sessionId: 'session-1', studentId: 'student-1', status: 'PRESENT' },
      { sessionId: 'session-2', studentId: 'student-1', status: 'LATE' },
      { sessionId: 'session-3', studentId: 'student-1', status: 'PRESENT' },
      { sessionId: 'session-4', studentId: 'student-1', status: 'ABSENT' },
      { sessionId: 'session-5', studentId: 'student-1', status: 'PRESENT' },
      { sessionId: 'session-1', studentId: 'student-2', status: 'ABSENT' },
      { sessionId: 'session-2', studentId: 'student-2', status: 'ABSENT' },
      { sessionId: 'session-3', studentId: 'student-2', status: 'ABSENT' },
      { sessionId: 'session-4', studentId: 'student-2', status: 'PRESENT' },
      { sessionId: 'session-5', studentId: 'student-2', status: 'ABSENT' },
    ]);

    const service = new AttendanceAnalyticsService(prisma as never);
    const summary = await service.getClassSummary('class-1', 'term-1', 'office-1', [RoleName.OFFICE]);
    expect(summary.totals.attendanceRate).toBe(50);
    expect(summary.students[0].attendanceRate).toBe(80);

    const alerts = await service.getChronicAbsence('class-1', 'term-1', 'office-1', [RoleName.OFFICE], 0.4, 5);
    expect(alerts.flaggedCount).toBe(1);
    expect(alerts.flagged[0].student.id).toBe('student-2');
    expect(alerts.flagged[0].absenceRate).toBe(80);
  });
});
