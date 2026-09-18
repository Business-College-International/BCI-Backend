import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdmissionDecision, ApplicationStatus, Prisma } from '@prisma/client';
import { ApplicationsService } from './applications.service';

type MockPrisma = { application: { findUnique: jest.Mock }; $transaction: jest.Mock };
function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    academicYear: { findUnique: jest.fn() },
    term: { findUnique: jest.fn() },
    schoolClass: { findUnique: jest.fn() },
    enrolment: { count: jest.fn(), create: jest.fn() },
    student: { findUnique: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn() },
    person: { findFirst: jest.fn(), create: jest.fn() },
    guardian: { upsert: jest.fn(), create: jest.fn() },
    guardianStudent: { findUnique: jest.fn(), create: jest.fn() },
    application: { findUnique: jest.fn(), updateMany: jest.fn() },
    admissionDecisionRecord: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    ...overrides,
  };
}
function makePrisma(tx: any = makeTx(), transactionError?: unknown): MockPrisma & { tx: any } {
  return {
    application: { findUnique: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: any) => unknown, _options: unknown) => {
      if (transactionError) throw transactionError;
      return callback(tx);
    }),
    tx,
  };
}
function makeApplication() { return { id: 'application-1', trackingCode: 'BCI-TRACK-1', firstName: 'Ama', lastName: 'Doe', dob: new Date('2010-01-01'), levelApplied: 'SHS1', programmeApplied: 'BUSINESS', guardianName: 'Jane Doe', guardianPhone: '+233200000000', previousSchool: 'Previous School', passportPhotoUrl: null, status: ApplicationStatus.UNDER_REVIEW }; }

function seedValidAdmission(tx: any, current = makeApplication()) {
  tx.application.findUnique.mockResolvedValue(current);
  tx.academicYear.findUnique.mockResolvedValue({ id: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2027-07-31') });
  tx.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-31'), status: 'OPEN' });
  tx.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', academicYearId: 'year-1', level: 'SHS1', programme: 'BUSINESS', capacity: 40 });
  tx.enrolment.count.mockResolvedValue(12);
  tx.student.findUnique.mockResolvedValue(null);
  tx.user.findUnique.mockResolvedValue(null);
  tx.person.findFirst.mockResolvedValue(null);
  tx.person.create.mockResolvedValue({ id: 'guardian-person-1' });
  tx.guardian.create.mockResolvedValue({ personId: 'guardian-person-1' });
  tx.guardianStudent.findUnique.mockResolvedValue(null);
  tx.guardianStudent.create.mockResolvedValue({ id: 'link-1' });
  tx.student.create.mockResolvedValue({ id: 'student-1', admissionNumber: 'BCI-001' });
  tx.enrolment.create.mockResolvedValue({ id: 'enrolment-1', status: 'ACTIVE' });
  tx.application.updateMany.mockResolvedValue({ count: 1 });
}

describe('ApplicationsService admission integrity', () => {
  it('rejects a class from a different academic year', async () => {
    const current = makeApplication(); const tx = makeTx();
    tx.application.findUnique.mockResolvedValue(current);
    tx.academicYear.findUnique.mockResolvedValue({ id: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2027-07-31') });
    tx.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-31'), status: 'OPEN' });
    tx.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', academicYearId: 'year-2', level: 'SHS1', programme: 'BUSINESS', capacity: 40 });
    const prisma = makePrisma(tx);
    await expect(new ApplicationsService(prisma as never).admit('application-1', { academicYearId: 'year-1', termId: 'term-1', classId: 'class-1' }, 'office-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects admission when the selected class is full', async () => {
    const current = makeApplication(); const tx = makeTx();
    tx.application.findUnique.mockResolvedValue(current);
    tx.academicYear.findUnique.mockResolvedValue({ id: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2027-07-31') });
    tx.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-31'), status: 'OPEN' });
    tx.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', academicYearId: 'year-1', level: 'SHS1', programme: 'BUSINESS', capacity: 40 });
    tx.enrolment.count.mockResolvedValue(40);
    const prisma = makePrisma(tx);
    await expect(new ApplicationsService(prisma as never).admit('application-1', { academicYearId: 'year-1', termId: 'term-1', classId: 'class-1' }, 'office-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('locks the application and target class before checking admission capacity', async () => {
    const tx = makeTx();
    seedValidAdmission(tx);
    const prisma = makePrisma(tx);
    await new ApplicationsService(prisma as never).admit(
      'application-1',
      { academicYearId: 'year-1', termId: 'term-1', classId: 'class-1' },
      'office-1',
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.enrolment.count).toHaveBeenCalledWith({
      where: { classId: 'class-1', termId: 'term-1', status: 'ACTIVE' },
    });
  });

  it('creates the student, guardian link, enrolment, decision, and audit entry atomically', async () => {
    const tx = makeTx(); seedValidAdmission(tx);
    const prisma = makePrisma(tx);
    await expect(new ApplicationsService(prisma as never).admit('application-1', { academicYearId: 'year-1', termId: 'term-1', classId: 'class-1', admissionNumber: 'BCI-001' }, 'office-1')).resolves.toMatchObject({ applicationId: 'application-1', student: { id: 'student-1' }, enrolment: { id: 'enrolment-1' } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    expect(tx.application.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'application-1', status: ApplicationStatus.UNDER_REVIEW } }));
    expect(tx.admissionDecisionRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ applicationId: 'application-1', decision: AdmissionDecision.ADMITTED }) }));
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('translates a concurrent capacity admission into a retryable conflict', async () => {
    const tx = makeTx();
    const prisma = makePrisma(tx, { code: 'P2034' });
    await expect(new ApplicationsService(prisma as never).admit('application-1', { academicYearId: 'year-1', termId: 'term-1', classId: 'class-1' }, 'office-1'))
      .rejects.toEqual(expect.objectContaining({ message: 'Admission changed concurrently. Please retry the admission.' }));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  });
});

describe('ApplicationsService review integrity', () => {
  it('locks the application before applying a review transition', async () => {
    const current = makeApplication();
    const tx = makeTx();
    tx.$queryRaw.mockResolvedValue([{ id: 'application-1' }]);
    tx.application.findUnique.mockResolvedValue(current);
    tx.application.updateMany.mockResolvedValue({ count: 0 });
    const prisma = makePrisma(tx);

    await expect(new ApplicationsService(prisma as never).review('application-1', 'REJECTED', 'Incomplete documents', 'office-1'))
      .rejects.toEqual(expect.objectContaining({ message: 'Application changed while it was being reviewed.' }));

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });


  it('uses a conditional state transition so a concurrent review cannot overwrite a newer status', async () => {
    const current = makeApplication();
    const tx = makeTx();
    tx.application.findUnique.mockResolvedValue(current);
    tx.application.updateMany.mockResolvedValue({ count: 0 });
    const prisma = makePrisma(tx);

    await expect(new ApplicationsService(prisma as never).review('application-1', 'REJECTED', 'Incomplete documents', 'office-1'))
      .rejects.toEqual(expect.objectContaining({ message: 'Application changed while it was being reviewed.' }));
    expect(tx.admissionDecisionRecord.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('records a rejection only after the conditional transition succeeds', async () => {
    const current = makeApplication();
    const tx = makeTx();
    tx.application.findUnique
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ id: 'application-1', trackingCode: 'BCI-TRACK-1', status: ApplicationStatus.REJECTED, updatedAt: new Date() });
    tx.application.updateMany.mockResolvedValue({ count: 1 });
    const prisma = makePrisma(tx);

    await expect(new ApplicationsService(prisma as never).review('application-1', 'REJECTED', 'Incomplete documents', 'office-1')).resolves.toMatchObject({ status: ApplicationStatus.REJECTED });
    expect(tx.application.updateMany).toHaveBeenCalledWith({ where: { id: 'application-1', status: ApplicationStatus.UNDER_REVIEW }, data: { status: ApplicationStatus.REJECTED, reviewedBy: 'office-1' } });
    expect(tx.admissionDecisionRecord.create).toHaveBeenCalledWith({ data: { applicationId: 'application-1', decision: AdmissionDecision.REJECTED, decidedBy: 'office-1', reason: 'Incomplete documents' } });
  });
});

describe('ApplicationsService public tracking', () => {
  it('returns a public-safe timeline without guardian or internal decision fields', async () => {
    const prisma = makePrisma();
    prisma.application.findUnique.mockResolvedValue({
      trackingCode: 'BCI-TRACK-1', levelApplied: 'SHS1', programmeApplied: 'BUSINESS', status: 'ADMITTED',
      submittedAt: new Date('2026-01-01T10:00:00Z'), updatedAt: new Date('2026-01-03T10:00:00Z'),
      admissionDecisions: [{ decision: AdmissionDecision.ADMITTED, decidedAt: new Date('2026-01-03T09:00:00Z') }],
    });
    const result = await new ApplicationsService(prisma as never).findByTrackingCode('BCI-TRACK-1');
    expect(result.timeline).toEqual([{ code: 'SUBMITTED', at: new Date('2026-01-01T10:00:00Z') }, { code: 'ADMITTED', at: new Date('2026-01-03T09:00:00Z') }]);
    expect(result).not.toHaveProperty('guardianPhone'); expect(result).not.toHaveProperty('guardianName'); expect(result).not.toHaveProperty('reason');
  });
});
