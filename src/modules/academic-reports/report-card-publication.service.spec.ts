import { ConflictException } from '@nestjs/common';
import { ReportCardPublicationStatus } from '@prisma/client';
import { ReportCardPublicationService } from './report-card-publication.service';

describe('ReportCardPublicationService', () => {
  function makePrisma() {
    const tx = {
      $executeRawUnsafe: jest.fn(),
      reportCardPublication: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      ...tx,
      term: { findUnique: jest.fn() },
      reportCardPublication: tx.reportCardPublication,
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    return { prisma, tx };
  }

  it('rejects preparation until the term is closed', async () => {
    const { prisma } = makePrisma();
    const reports = { getStudentTermSummary: jest.fn() };
    const readiness = { getClassReadiness: jest.fn() };
    prisma.term.findUnique.mockResolvedValue({ id: 'term-1', status: 'OPEN' });
    const service = new ReportCardPublicationService(prisma as never, reports as never, readiness as never);
    await expect(service.prepare('student-1', 'term-1', 'user-1', ['OFFICE'] as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores a ready snapshot linked to the grading policy version', async () => {
    const { prisma, tx } = makePrisma();
    const reports = {
      getStudentTermSummary: jest.fn().mockResolvedValue({
        student: { id: 'student-1', admissionNumber: 'BCI-1', firstName: 'Ama', lastName: 'Mensah', status: 'ACTIVE' },
        term: { id: 'term-1', code: 'T1', name: 'Term 1', startsAt: '2026-09-01', endsAt: '2026-12-20' },
        placement: { enrolmentId: 'e-1', level: 'SHS1', programme: 'BUSINESS', class: { id: 'class-1', name: 'Business A' } },
        calculation: { overallPercentage: 82, mode: 'WEIGHTED', weightedAssessmentCount: 3, unweightedAssessmentCount: 0, totalConfiguredWeight: 100 },
        subjects: [],
        assessments: [],
        attendance: { totalMarkedSessions: 2, present: 2, absent: 0, late: 0, excused: 0, attendanceRate: 100, sessions: [] },
        grading: { assigned: true, policyVersionId: 'policy-1', policyVersion: 'GRADING-2026-TEST', gradeCode: 'A', descriptor: 'Pass', pass: true, points: 4 },
      }),
    };
    const readiness = { getClassReadiness: jest.fn().mockResolvedValue({ students: [{ student: { id: 'student-1' }, ready: true, reasons: [] }] }) };
    prisma.term.findUnique.mockResolvedValue({ id: 'term-1', status: 'CLOSED' });
    tx.reportCardPublication.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ publicationVersion: 2 });
    tx.reportCardPublication.create.mockResolvedValue({ id: 'pub-1', status: ReportCardPublicationStatus.READY_FOR_PUBLICATION, publicationVersion: 3 });

    const service = new ReportCardPublicationService(prisma as never, reports as never, readiness as never);
    const result = await service.prepare('student-1', 'term-1', 'user-1', ['OFFICE'] as never);

    expect(result).toMatchObject({ id: 'pub-1', publicationVersion: 3, status: ReportCardPublicationStatus.READY_FOR_PUBLICATION });
    expect(tx.reportCardPublication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ studentId: 'student-1', termId: 'term-1', publicationVersion: 3, gradingPolicyVersionId: 'policy-1' }),
    }));
  });

  it('requires a reason when voiding', async () => {
    const { prisma } = makePrisma();
    const reports = { getStudentTermSummary: jest.fn() };
    const readiness = { getClassReadiness: jest.fn() };
    const service = new ReportCardPublicationService(prisma as never, reports as never, readiness as never);
    await expect(service.void('pub-1', 'user-1', ['OFFICE'] as never, '  ')).rejects.toBeInstanceOf(ConflictException);
  });
});