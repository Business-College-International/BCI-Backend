import { ReportReadinessService } from './report-readiness.service';

describe('ReportReadinessService', () => {
  function makeService(overrides: Record<string, unknown> = {}) {
    const prisma = {
      term: { findUnique: jest.fn() },
      schoolClass: { findUnique: jest.fn() },
      enrolment: { findMany: jest.fn() },
      assessment: { findMany: jest.fn() },
      assessmentResult: { findMany: jest.fn() },
      gradingPolicy: { findFirst: jest.fn().mockResolvedValue(null) },
      staff: { findUnique: jest.fn() },
      teacherAssignment: { findFirst: jest.fn() },
      ...overrides,
    } as never;
    return { service: new ReportReadinessService(prisma), prisma: prisma as unknown as Record<string, Record<string, jest.Mock>> };
  }

  it('blocks publication readiness while the term is open and grading policy is absent', async () => {
    const { service, prisma } = makeService();
    prisma.term.findUnique.mockResolvedValue({ id: 'term-1', name: 'Term 1', status: 'OPEN', academicYearId: 'year-1' });
    prisma.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', name: 'General Arts A', academicYearId: 'year-1', level: 'SHS1', programme: 'GENERAL_ARTS' });
    prisma.enrolment.findMany.mockResolvedValue([{ studentId: 'student-1', student: { admissionNumber: 'BCI-1', firstName: 'Ama', lastName: 'Mensah' } }]);
    prisma.assessment.findMany.mockResolvedValue([{ id: 'assessment-1', title: 'Test 1', type: 'TEST', subjectId: 'subject-1', weight: 100, maxScore: 100, subject: { code: 'MAT', name: 'Mathematics' } }]);
    prisma.assessmentResult.findMany.mockResolvedValue([{ studentId: 'student-1', assessmentId: 'assessment-1' }]);

    await expect(service.getClassReadiness('class-1', 'term-1', 'actor-1', ['OFFICE'] as never)).resolves.toMatchObject({
      totals: { readyStudents: 0, blockedStudents: 1 },
      students: [{ ready: false, reasons: ['TERM_NOT_CLOSED', 'GRADING_POLICY_REQUIRED'] }],
    });
  });

  it('does not block readiness when an active grading policy covers the class scope', async () => {
    const { service, prisma } = makeService();
    prisma.term.findUnique.mockResolvedValue({ id: 'term-1', name: 'Term 1', status: 'CLOSED', academicYearId: 'year-1' });
    prisma.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', name: 'Business A', academicYearId: 'year-1', level: 'SHS1', programme: 'BUSINESS' });
    prisma.enrolment.findMany.mockResolvedValue([{ studentId: 'student-1', student: { admissionNumber: 'BCI-1', firstName: 'Kojo', lastName: 'Owusu' } }]);
    prisma.assessment.findMany.mockResolvedValue([{ id: 'assessment-1', title: 'Test 1', type: 'TEST', subjectId: 'subject-1', weight: 100, maxScore: 100, subject: { code: 'ACC', name: 'Accounting' } }]);
    prisma.assessmentResult.findMany.mockResolvedValue([{ studentId: 'student-1', assessmentId: 'assessment-1' }]);
    prisma.gradingPolicy.findFirst.mockResolvedValue({ id: 'policy-1', version: 'GRADING-2026-TEST' });

    await expect(service.getClassReadiness('class-1', 'term-1', 'actor-1', ['OFFICE'] as never)).resolves.toMatchObject({
      policy: { gradingConfigured: true, policyVersionId: 'policy-1', policyVersion: 'GRADING-2026-TEST', reason: null },
      totals: { readyStudents: 1, blockedStudents: 0 },
      students: [{ ready: true, reasons: [] }],
    });
  });

  it('flags missing assessment results by student', async () => {
    const { service, prisma } = makeService();
    prisma.term.findUnique.mockResolvedValue({ id: 'term-1', name: 'Term 1', status: 'CLOSED', academicYearId: 'year-1' });
    prisma.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', name: 'Business A', academicYearId: 'year-1', level: 'SHS1', programme: 'BUSINESS' });
    prisma.enrolment.findMany.mockResolvedValue([{ studentId: 'student-1', student: { admissionNumber: 'BCI-1', firstName: 'Kojo', lastName: 'Owusu' } }]);
    prisma.assessment.findMany.mockResolvedValue([
      { id: 'assessment-1', title: 'Classwork 1', type: 'CLASSWORK', subjectId: 'subject-1', weight: 50, maxScore: 20, subject: { code: 'ACC', name: 'Accounting' } },
      { id: 'assessment-2', title: 'Test 1', type: 'TEST', subjectId: 'subject-1', weight: 50, maxScore: 50, subject: { code: 'ACC', name: 'Accounting' } },
    ]);
    prisma.assessmentResult.findMany.mockResolvedValue([{ studentId: 'student-1', assessmentId: 'assessment-1' }]);

    await expect(service.getClassReadiness('class-1', 'term-1', 'actor-1', ['OFFICE'] as never)).resolves.toMatchObject({
      totals: { readyStudents: 0, blockedStudents: 1 },
      students: [{ reasons: ['GRADING_POLICY_REQUIRED', 'MISSING_RESULTS'], missingAssessments: [{ assessmentId: 'assessment-2' }] }],
    });
  });
});