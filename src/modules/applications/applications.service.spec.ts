import { BadRequestException, ConflictException } from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import { ApplicationsService } from './applications.service';

type MockPrisma = {
  application: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

function makePrisma(txOverrides: Record<string, unknown> = {}): MockPrisma {
  return {
    application: { findUnique: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(txOverrides)),
  };
}

function makeApplication() {
  return {
    id: 'application-1',
    trackingCode: 'BCI-TRACK-1',
    firstName: 'Ama',
    lastName: 'Doe',
    dob: new Date('2010-01-01'),
    levelApplied: 'SHS1',
    programmeApplied: 'BUSINESS',
    guardianName: 'Jane Doe',
    guardianPhone: '+233200000000',
    previousSchool: 'Previous School',
    passportPhotoUrl: null,
    status: ApplicationStatus.UNDER_REVIEW,
  };
}

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    academicYear: { findUnique: jest.fn() },
    term: { findUnique: jest.fn() },
    schoolClass: { findUnique: jest.fn() },
    enrolment: { count: jest.fn() },
    student: { findUnique: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn() },
    person: { findFirst: jest.fn(), create: jest.fn() },
    guardian: { upsert: jest.fn(), create: jest.fn() },
    guardianStudent: { findUnique: jest.fn(), create: jest.fn() },
    application: { updateMany: jest.fn() },
    admissionDecisionRecord: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    ...overrides,
  };
}

describe('ApplicationsService admission integrity', () => {
  it('rejects a class from a different academic year', async () => {
    const current = makeApplication();
    const tx = makeTx();
    tx.academicYear.findUnique.mockResolvedValue({ id: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2027-07-31') });
    tx.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-31'), status: 'OPEN' });
    tx.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', academicYearId: 'year-2', level: 'SHS1', programme: 'BUSINESS', capacity: 40 });

    const prisma = makePrisma();
    prisma.application.findUnique.mockResolvedValue(current);
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(tx));
    const service = new ApplicationsService(prisma as never);

    await expect(service.admit('application-1', {
      academicYearId: 'year-1',
      termId: 'term-1',
      classId: 'class-1',
    }, 'office-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects admission when the selected class is full', async () => {
    const current = makeApplication();
    const tx = makeTx();
    tx.academicYear.findUnique.mockResolvedValue({ id: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2027-07-31') });
    tx.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-31'), status: 'OPEN' });
    tx.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', academicYearId: 'year-1', level: 'SHS1', programme: 'BUSINESS', capacity: 40 });
    tx.enrolment.count.mockResolvedValue(40);

    const prisma = makePrisma();
    prisma.application.findUnique.mockResolvedValue(current);
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(tx));
    const service = new ApplicationsService(prisma as never);

    await expect(service.admit('application-1', {
      academicYearId: 'year-1',
      termId: 'term-1',
      classId: 'class-1',
    }, 'office-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
