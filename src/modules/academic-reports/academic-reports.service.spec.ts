import { AcademicReportsService } from './academic-reports.service';
import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';

function makePrisma() {
  return {
    student: { findUnique: jest.fn() },
    term: { findUnique: jest.fn() },
    guardian: { findUnique: jest.fn() },
    guardianStudent: { findUnique: jest.fn() },
    staff: { findUnique: jest.fn() },
    enrolment: { findFirst: jest.fn() },
    teacherAssignment: { findFirst: jest.fn() },
    assessmentResult: { findMany: jest.fn() },
  };
}

describe('AcademicReportsService', () => {
  it('derives a weighted term percentage without storing calculated grades', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue({
      id: 'student-1',
      admissionNumber: 'BCI-001',
      firstName: 'Ama',
      lastName: 'Doe',
      status: 'ACTIVE',
    });
    prisma.term.findUnique.mockResolvedValue({
      id: 'term-1',
      code: 'T1',
      name: 'First Term',
      startsAt: new Date('2026-09-01'),
      endsAt: new Date('2026-12-20'),
    });
    prisma.assessmentResult.findMany.mockResolvedValue([
      {
        id: 'result-1',
        score: { toString: () => '80' },
        remark: null,
        enteredAt: new Date(),
        assessment: {
          id: 'assessment-1',
          title: 'Test',
          type: 'TEST',
          maxScore: { toString: () => '100' },
          weight: { toString: () => '40' },
          subject: { code: 'MAT', name: 'Mathematics' },
        },
      },
      {
        id: 'result-2',
        score: { toString: () => '45' },
        remark: 'Good',
        enteredAt: new Date(),
        assessment: {
          id: 'assessment-2',
          title: 'Exam',
          type: 'EXAM',
          maxScore: { toString: () => '50' },
          weight: { toString: () => '60' },
          subject: { code: 'MAT', name: 'Mathematics' },
        },
      },
    ]);

    const service = new AcademicReportsService(prisma as never);
    const report = await service.getStudentTermSummary('student-1', 'term-1', 'director-1', [RoleName.DIRECTOR]);

    expect(report.calculation.mode).toBe('WEIGHTED');
    expect(report.calculation.overallPercentage).toBe(86);
    expect(report.grading.assigned).toBe(false);
    expect(report.subjects[0].averagePercentage).toBe(85);
  });

  it('denies a guardian whose ward link has academic visibility disabled', async () => {
    const prisma = makePrisma();
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1', admissionNumber: null, firstName: 'Ama', lastName: 'Doe', status: 'ACTIVE' });
    prisma.term.findUnique.mockResolvedValue({ id: 'term-1', code: 'T1', name: 'First Term', startsAt: new Date(), endsAt: new Date() });
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canViewAcademic: false });

    const service = new AcademicReportsService(prisma as never);

    await expect(
      service.getStudentTermSummary('student-1', 'term-1', 'guardian-user', [RoleName.GUARDIAN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
