import { AcademicReportsService } from './academic-reports.service';
import { RoleName } from '@prisma/client';

describe('AcademicReportsService attendance draft', () => {
  it('includes placement and term attendance without requiring grading publication', async () => {
    const prisma = {
      academicYear: { findFirst: jest.fn() },
      term: { findUnique: jest.fn() },
      enrolment: { findFirst: jest.fn() },
      student: { findUnique: jest.fn() },
      assessmentResult: { findMany: jest.fn() },
      attendanceRecord: { findMany: jest.fn() },
      guardian: { findUnique: jest.fn() },
      guardianStudent: { findUnique: jest.fn() },
      staff: { findUnique: jest.fn() },
      teacherAssignment: { findFirst: jest.fn() },
    } as any;

    prisma.student.findUnique.mockResolvedValue({
      id: 'student-1',
      admissionNumber: 'BCI-001',
      firstName: 'Ama',
      lastName: 'Mensah',
      status: 'ACTIVE',
    });
    prisma.term.findUnique.mockResolvedValue({
      id: 'term-1',
      code: 'T1',
      name: 'First Term',
      startsAt: new Date('2026-01-01'),
      endsAt: new Date('2026-04-01'),
      academicYearId: 'year-1',
    });
    prisma.enrolment.findFirst.mockResolvedValue({
      id: 'enrol-1',
      classId: 'class-1',
      level: 'SHS1',
      programme: 'BUSINESS',
      class: { id: 'class-1', name: 'Business A', division: 'A', room: 'R1' },
    });
    prisma.assessmentResult.findMany.mockResolvedValue([]);
    prisma.attendanceRecord.findMany.mockResolvedValue([
      { id: 'a1', status: 'PRESENT', markedAt: new Date(), session: { id: 's1', sessionDate: new Date('2026-01-10'), subjectId: null, periodLabel: null } },
      { id: 'a2', status: 'LATE', markedAt: new Date(), session: { id: 's2', sessionDate: new Date('2026-01-11'), subjectId: null, periodLabel: null } },
      { id: 'a3', status: 'ABSENT', markedAt: new Date(), session: { id: 's3', sessionDate: new Date('2026-01-12'), subjectId: null, periodLabel: null } },
      { id: 'a4', status: 'EXCUSED', markedAt: new Date(), session: { id: 's4', sessionDate: new Date('2026-01-13'), subjectId: null, periodLabel: null } },
    ]);

    const service = new AcademicReportsService(prisma);
    const result = await service.getStudentTermSummary('student-1', 'term-1', 'office-1', [RoleName.OFFICE]);

    expect(result.placement?.class.name).toBe('Business A');
    expect(result.attendance.totalMarkedSessions).toBe(4);
    expect(result.attendance.present).toBe(1);
    expect(result.attendance.late).toBe(1);
    expect(result.attendance.absent).toBe(1);
    expect(result.attendance.excused).toBe(1);
    expect(result.attendance.attendanceRate).toBe(50);
    expect(result.grading.assigned).toBe(false);
    expect(result.publication.state).toBe('DRAFT_VIEW');
  });
});
