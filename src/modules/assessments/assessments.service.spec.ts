import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AssessmentType, RoleName } from '@prisma/client';
import { AssessmentsService } from './assessments.service';

type MockTx = {
  $queryRaw: jest.Mock;
  term: { findUnique: jest.Mock };
  schoolClass: { findUnique?: jest.Mock };
  subject: { findUnique: jest.Mock };
  staff: { findUnique: jest.Mock };
  teacherAssignment: { findFirst: jest.Mock; findMany: jest.Mock };
  assessment: { create: jest.Mock; findUnique: jest.Mock };
  enrolment: { findFirst: jest.Mock; findMany: jest.Mock };
  assessmentResult: { upsert: jest.Mock; findMany: jest.Mock };
  auditLog: { create: jest.Mock };
};

function makeTx(): MockTx {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'term-1' }]),
    term: { findUnique: jest.fn() },
    schoolClass: { findUnique: jest.fn() },
    subject: { findUnique: jest.fn() },
    staff: { findUnique: jest.fn() },
    teacherAssignment: { findFirst: jest.fn(), findMany: jest.fn() },
    assessment: { create: jest.fn(), findUnique: jest.fn() },
    enrolment: { findFirst: jest.fn(), findMany: jest.fn() },
    assessmentResult: { upsert: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
}

function makePrisma(tx: MockTx): any {
  return {
    $transaction: jest.fn(async (callback: (value: MockTx) => unknown) => callback(tx)),
    term: tx.term,
    schoolClass: tx.schoolClass,
    subject: tx.subject,
    student: { findUnique: jest.fn() },
    guardian: { findUnique: jest.fn() },
    staff: tx.staff,
    enrolment: tx.enrolment,
    teacherAssignment: tx.teacherAssignment,
    assessmentResult: { findMany: jest.fn() },
  };
}

describe('AssessmentsService', () => {
  it('denies a teacher who is not assigned to the subject', async () => {
    const tx = makeTx();
    tx.term.findUnique.mockResolvedValue({ id: 'term-1', status: 'OPEN' });
    tx.subject.findUnique.mockResolvedValue({ id: 'subject-1' });
    tx.staff.findUnique.mockResolvedValue({ personId: 'staff-1' });
    tx.teacherAssignment.findFirst.mockResolvedValue(null);

    const service = new AssessmentsService(makePrisma(tx));

    await expect(service.createAssessment({
      termId: 'term-1',
      subjectId: 'subject-1',
      title: 'Mid Term Test',
      type: AssessmentType.TEST,
      maxScore: 50,
    }, 'teacher-user', [RoleName.TEACHER])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a result for a student outside the teacher assigned class', async () => {
    const tx = makeTx();
    tx.$queryRaw.mockResolvedValue([{ id: 'term-1' }]);
    tx.assessment.findUnique.mockResolvedValue({
      id: 'assessment-1',
      termId: 'term-1',
      subjectId: 'subject-1',
      maxScore: 50,
      term: { status: 'OPEN' },
    });
    tx.staff.findUnique.mockResolvedValue({ personId: 'staff-1' });
    tx.teacherAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
    tx.enrolment.findMany.mockResolvedValue([
      { studentId: 'student-1', classId: 'class-outside-scope' },
    ]);
    tx.teacherAssignment.findMany.mockResolvedValue([{ classId: 'class-assigned' }]);

    const service = new AssessmentsService(makePrisma(tx));

    await expect(service.enterResults('assessment-1', {
      results: [{ studentId: 'student-1', score: 45 }],
    }, 'office-user', [RoleName.OFFICE])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a score above the assessment maximum', async () => {
    const tx = makeTx();
    tx.$queryRaw.mockResolvedValue([{ id: 'term-1' }]);
    tx.assessment.findUnique.mockResolvedValue({
      id: 'assessment-1',
      termId: 'term-1',
      subjectId: 'subject-1',
      maxScore: 50,
      term: { status: 'OPEN' },
    });
    tx.staff.findUnique.mockResolvedValue({ personId: 'staff-1' });
    tx.teacherAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
    tx.enrolment.findMany.mockResolvedValue([{ studentId: 'student-1', classId: 'class-assigned' }]);
    tx.teacherAssignment.findMany.mockResolvedValue([{ classId: 'class-assigned' }]);

    const service = new AssessmentsService(makePrisma(tx));

    await expect(service.enterResults('assessment-1', {
      results: [{ studentId: 'student-1', score: 51 }],
    }, 'office-user', [RoleName.OFFICE])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('locks the term before entering assessment results', async () => {
    const tx = makeTx();
    tx.assessment.findUnique
      .mockResolvedValueOnce({ id: 'assessment-1', termId: 'term-1' })
      .mockResolvedValueOnce({
        id: 'assessment-1',
        termId: 'term-1',
        subjectId: 'subject-1',
        maxScore: 50,
        term: { status: 'OPEN' },
      });
    tx.$queryRaw.mockResolvedValue([{ id: 'term-1' }]);

    const service = new AssessmentsService(makePrisma(tx));
    await expect(service.enterResults('assessment-1', {
      results: [{ studentId: 'student-1', score: 51 }],
    }, 'teacher-user', [RoleName.TEACHER])).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.assessment.findUnique).toHaveBeenCalledTimes(2);
  });

  it('blocks result entry after the term is closed', async () => {
    const tx = makeTx();
    tx.$queryRaw.mockResolvedValue([{ id: 'term-1' }]);
    tx.assessment.findUnique.mockResolvedValue({
      id: 'assessment-1',
      termId: 'term-1',
      subjectId: 'subject-1',
      maxScore: 50,
      term: { status: 'CLOSED' },
    });

    const service = new AssessmentsService(makePrisma(tx));

    await expect(service.enterResults('assessment-1', {
      results: [{ studentId: 'student-1', score: 40 }],
    }, 'teacher-user', [RoleName.TEACHER])).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.assessmentResult.upsert).not.toHaveBeenCalled();
  });
  it('denies a teacher requesting assessments for a term where they are not assigned', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx);
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.guardian.findUnique.mockResolvedValue(null);
    tx.staff.findUnique.mockResolvedValue({ personId: 'staff-1' });
    tx.enrolment.findMany.mockResolvedValue([]);
    // Historical term must resolve through the requested enrolment scope.
    tx.teacherAssignment.findFirst.mockResolvedValue(null);

    const service = new AssessmentsService(prisma);

    await expect(
      service.getStudentAssessments('student-1', 'teacher-user', [RoleName.TEACHER], 'historical-term-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.enrolment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: 'student-1', status: 'ACTIVE', termId: 'historical-term-1' },
    }));
    expect(prisma.assessmentResult.findMany).not.toHaveBeenCalled();
  });

});

describe('AssessmentsService assessment roster', () => {
  function primeRosterMocks(tx: MockTx) {
    tx.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1', status: 'OPEN' });
    tx.schoolClass?.findUnique?.mockResolvedValue({ id: 'class-1', academicYearId: 'year-1', level: 'SHS1' });
    tx.subject.findUnique.mockResolvedValue({ id: 'subject-1', level: 'SHS1' });
  }

  it('returns active students for an assigned teacher class/subject', async () => {
    const tx = makeTx();
    primeRosterMocks(tx);
    tx.staff.findUnique.mockResolvedValue({ personId: 'staff-1' });
    tx.teacherAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
    tx.enrolment.findMany.mockResolvedValue([
      { student: { id: 'student-1', admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Doe', status: 'ACTIVE' } },
    ]);

    const service = new AssessmentsService(makePrisma(tx));
    const result = await service.getAssessmentRoster(
      'class-1', 'term-1', 'subject-1', 'teacher-user', [RoleName.TEACHER],
    );

    expect(result).toEqual([
      { id: 'student-1', admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Doe', status: 'ACTIVE' },
    ]);
  });

  it('denies a teacher who is not assigned to the requested class', async () => {
    const tx = makeTx();
    primeRosterMocks(tx);
    tx.staff.findUnique.mockResolvedValue({ personId: 'staff-1' });
    tx.teacherAssignment.findFirst.mockResolvedValue(null);

    const service = new AssessmentsService(makePrisma(tx));

    await expect(service.getAssessmentRoster(
      'class-1', 'term-1', 'subject-1', 'teacher-user', [RoleName.TEACHER],
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a class from a different academic year', async () => {
    const tx = makeTx();
    tx.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1', status: 'OPEN' });
    tx.schoolClass?.findUnique?.mockResolvedValue({ id: 'class-1', academicYearId: 'year-2', level: 'SHS1' });
    tx.subject.findUnique.mockResolvedValue({ id: 'subject-1', level: 'SHS1' });

    const service = new AssessmentsService(makePrisma(tx));

    await expect(service.getAssessmentRoster(
      'class-1', 'term-1', 'subject-1', 'teacher-user', [RoleName.TEACHER],
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});
