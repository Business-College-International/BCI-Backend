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
    attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    gradingPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
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

  it('resolves an official grade from the active academic policy', async () => {
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
      academicYearId: 'year-1',
    });
    prisma.enrolment.findFirst.mockResolvedValue({
      id: 'enrolment-1',
      classId: 'class-1',
      level: 'P1',
      programme: 'NONE',
      class: { id: 'class-1', name: 'P1 A', division: null, room: null },
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
        remark: null,
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
    prisma.gradingPolicy.findFirst.mockResolvedValue({
      id: 'policy-1',
      version: 'GRADING-2026-TEST',
      bands: [
        { code: 'F', lowerInclusive: { toString: () => '0' }, upperExclusive: { toString: () => '50' }, pass: false, descriptor: 'Fail', points: { toString: () => '0' }, order: 1 },
        { code: 'A', lowerInclusive: { toString: () => '50' }, upperExclusive: null, pass: true, descriptor: 'Pass', points: { toString: () => '4' }, order: 2 },
      ],
    });

    const report = await new AcademicReportsService(prisma as never).getStudentTermSummary(
      'student-1',
      'term-1',
      'director-1',
      [RoleName.DIRECTOR],
    );

    expect(report.grading).toMatchObject({
      assigned: true,
      gradeCode: 'A',
      policyVersionId: 'policy-1',
      policyVersion: 'GRADING-2026-TEST',
      pass: true,
      points: 4,
    });
  });

});