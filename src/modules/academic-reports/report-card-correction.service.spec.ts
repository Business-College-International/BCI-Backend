import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ReportCardCorrectionDecision, ReportCardPublicationStatus, RoleName } from '@prisma/client';
import { ReportCardCorrectionService } from './report-card-correction.service';

function makePrisma() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue([]),
    reportCardPublication: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    reportCardCorrectionRequest: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    student: { findUnique: jest.fn() },
    term: { findUnique: jest.fn() },
    reportCardPublication: tx.reportCardPublication,
    reportCardCorrectionRequest: tx.reportCardCorrectionRequest,
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { prisma, tx };
}

const report = {
  student: { id: 'student-1', admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Mensah', status: 'ACTIVE' },
  term: { id: 'term-1', code: 'T1', name: 'Term 1', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-20'), academicYearId: 'year-1' },
  placement: { enrolmentId: 'enrol-1', level: 'SHS1', programme: 'BUSINESS', class: { id: 'class-1', name: 'Business A' } },
  calculation: { overallPercentage: 82, mode: 'WEIGHTED', weightedAssessmentCount: 3, unweightedAssessmentCount: 0, totalConfiguredWeight: 100 },
  subjects: [],
  assessments: [],
  attendance: { totalMarkedSessions: 2, present: 2, absent: 0, late: 0, excused: 0, attendanceRate: 100, sessions: [] },
  grading: { assigned: true, reason: null, policyVersionId: 'policy-1', policyVersion: 'GRADING-2026', gradeCode: 'A', descriptor: 'Pass', pass: true, points: 4 },
};

function snapshotFor(value: typeof report) {
  return {
    schemaVersion: 1,
    student: value.student,
    term: value.term,
    placement: value.placement,
    calculation: value.calculation,
    subjects: value.subjects,
    assessments: value.assessments,
    attendance: value.attendance,
    grading: value.grading,
  };
}

function hashSnapshot(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('ReportCardCorrectionService', () => {
  it('rejects correction requests from non-teachers and non-reviewers', async () => {
    const { prisma } = makePrisma();
    const reports = { getStudentTermSummary: jest.fn() };
    const service = new ReportCardCorrectionService(prisma as never, reports as never);

    await expect(service.request('student-1', 'term-1', 'Wrong mark', 'user-1', [RoleName.GUARDIAN]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a pending request from the authoritative report for an assigned teacher', async () => {
    const { prisma, tx } = makePrisma();
    prisma.reportCardPublication.findFirst.mockResolvedValue({
      id: 'pub-1',
      publicationVersion: 1,
      status: ReportCardPublicationStatus.PUBLISHED,
      gradingPolicyVersionId: 'policy-1',
    });
    const reports = { getStudentTermSummary: jest.fn().mockResolvedValue(report) };
    tx.reportCardCorrectionRequest.findFirst.mockResolvedValue(null);
    // Simulate the row returned after the transaction acquires the publication lock.
    tx.reportCardPublication.findUnique.mockResolvedValue({
      id: 'pub-1',
      publicationVersion: 1,
      status: ReportCardPublicationStatus.PUBLISHED,
    });
    tx.reportCardCorrectionRequest.create.mockImplementation(async ({ data }: any) => ({ id: 'corr-1', ...data }));
    const service = new ReportCardCorrectionService(prisma as never, reports as never);

    const result = await service.request('student-1', 'term-1', 'Assessment result needs correction.', 'teacher-1', [RoleName.TEACHER]);

    expect(result.id).toBe('corr-1');
    expect(result.decision).toBe(ReportCardCorrectionDecision.PENDING);
    expect(result.targetPublicationId).toBe('pub-1');
    expect(result.gradingPolicyVersionId).toBe('policy-1');
    expect(tx.reportCardCorrectionRequest.create).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: 'ReportCardCorrectionRequest' }),
    }));
  });

  it('rejects duplicate pending requests for the current publication', async () => {
    const { prisma, tx } = makePrisma();
    prisma.reportCardPublication.findFirst.mockResolvedValue({ id: 'pub-1', publicationVersion: 1, status: ReportCardPublicationStatus.PUBLISHED });
    const reports = { getStudentTermSummary: jest.fn().mockResolvedValue(report) };
    tx.reportCardCorrectionRequest.findFirst.mockResolvedValue({ id: 'corr-existing' });
    const service = new ReportCardCorrectionService(prisma as never, reports as never);

    await expect(service.request('student-1', 'term-1', 'Duplicate correction request', 'teacher-1', [RoleName.TEACHER]))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('approves a recalculated snapshot after the underlying assessment result changes', async () => {
    const { prisma, tx } = makePrisma();
    const correctedReport = {
      ...report,
      calculation: { ...report.calculation, overallPercentage: 88 },
      assessments: [{
        id: 'result-1',
        score: '44',
        maxScore: '50',
        percentage: 88,
        weight: 100,
        weightedContribution: 88,
        remark: 'Corrected mark',
        enteredAt: new Date('2026-09-20T08:00:00.000Z'),
        assessment: {
          id: 'assessment-1',
          title: 'Mid-term test',
          type: 'TEST',
          subject: { code: 'MAT', name: 'Mathematics' },
        },
      }],
    };
    const baselineSnapshot = snapshotFor(report);
    const correctedSnapshot = snapshotFor(correctedReport);
    const request = {
      id: 'corr-1',
      studentId: 'student-1',
      termId: 'term-1',
      targetPublicationId: 'pub-1',
      replacementSnapshotJson: baselineSnapshot,
      replacementSnapshotHash: hashSnapshot(baselineSnapshot),
      gradingPolicyVersionId: 'policy-1',
      decision: ReportCardCorrectionDecision.PENDING,
      reason: 'Correct an assessment result.',
    };

    prisma.reportCardCorrectionRequest.findUnique.mockResolvedValue(request);
    const reports = { getStudentTermSummary: jest.fn().mockResolvedValue(correctedReport) };
    tx.reportCardCorrectionRequest.findUnique.mockResolvedValue(request);
    tx.reportCardPublication.findUnique.mockResolvedValue({
      id: 'pub-1',
      studentId: 'student-1',
      termId: 'term-1',
      publicationVersion: 1,
      status: ReportCardPublicationStatus.PUBLISHED,
      snapshotHash: hashSnapshot(baselineSnapshot),
      gradingPolicyVersionId: 'policy-1',
    });
    tx.reportCardPublication.findFirst
      .mockResolvedValueOnce({ id: 'pub-1', publicationVersion: 1 })
      .mockResolvedValueOnce({ id: 'pub-1', publicationVersion: 1 });
    tx.reportCardPublication.update.mockResolvedValue({
      id: 'pub-1',
      status: ReportCardPublicationStatus.VOIDED,
      publicationVersion: 1,
    });
    tx.reportCardPublication.create.mockResolvedValue({
      id: 'pub-2',
      status: ReportCardPublicationStatus.PUBLISHED,
      publicationVersion: 2,
      snapshotHash: hashSnapshot(correctedSnapshot),
      gradingPolicyVersionId: 'policy-1',
    });
    tx.reportCardCorrectionRequest.update.mockResolvedValue({
      ...request,
      replacementSnapshotJson: correctedSnapshot,
      replacementSnapshotHash: hashSnapshot(correctedSnapshot),
      decision: ReportCardCorrectionDecision.APPROVED,
      approvedPublicationId: 'pub-2',
    });

    const service = new ReportCardCorrectionService(prisma as never, reports as never);
    const result = await service.approve(
      'corr-1',
      'Reviewed corrected assessment evidence.',
      'principal-1',
      [RoleName.PRINCIPAL],
    );

    expect(result.replacementPublication).toMatchObject({
      id: 'pub-2',
      publicationVersion: 2,
      status: ReportCardPublicationStatus.PUBLISHED,
    });
    expect(tx.reportCardPublication.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        snapshotJson: correctedSnapshot,
        snapshotHash: hashSnapshot(correctedSnapshot),
        gradingPolicyVersionId: 'policy-1',
      }),
    }));
    expect(tx.reportCardCorrectionRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'corr-1' },
      data: expect.objectContaining({
        decision: ReportCardCorrectionDecision.APPROVED,
        approvedPublicationId: 'pub-2',
        replacementSnapshotJson: correctedSnapshot,
        replacementSnapshotHash: hashSnapshot(correctedSnapshot),
      }),
    }));
  });

  it('rejects approval when the recalculated snapshot has no effective change', async () => {
    const { prisma } = makePrisma();
    const baselineSnapshot = snapshotFor(report);
    const request = {
      id: 'corr-noop',
      studentId: 'student-1',
      termId: 'term-1',
      targetPublicationId: 'pub-1',
      replacementSnapshotJson: baselineSnapshot,
      replacementSnapshotHash: hashSnapshot(baselineSnapshot),
      gradingPolicyVersionId: 'policy-1',
      decision: ReportCardCorrectionDecision.PENDING,
      reason: 'No-op correction.',
    };
    prisma.reportCardCorrectionRequest.findUnique.mockResolvedValue(request);
    const reports = { getStudentTermSummary: jest.fn().mockResolvedValue(report) };
    const service = new ReportCardCorrectionService(prisma as never, reports as never);

    await expect(
      service.approve(
        'corr-noop',
        'Reviewed and found no effective change.',
        'principal-1',
        [RoleName.PRINCIPAL],
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a correction without changing the publication', async () => {
    const { prisma, tx } = makePrisma();
    const request = { id: 'corr-1', decision: ReportCardCorrectionDecision.PENDING };
    tx.reportCardCorrectionRequest.findUnique.mockResolvedValue(request);
    tx.reportCardCorrectionRequest.updateMany.mockResolvedValue({ count: 1 });
    tx.reportCardCorrectionRequest.findUniqueOrThrow.mockResolvedValue({
      id: 'corr-1',
      decision: ReportCardCorrectionDecision.REJECTED,
    });
    const service = new ReportCardCorrectionService(prisma as never, {} as never);

    const result = await service.reject('corr-1', 'Source evidence does not support a correction.', 'office-1', [RoleName.OFFICE]);

    expect(result.decision).toBe(ReportCardCorrectionDecision.REJECTED);
    expect(tx.reportCardPublication.update).not.toHaveBeenCalled();
    expect(tx.reportCardPublication.create).not.toHaveBeenCalled();
  });
});
