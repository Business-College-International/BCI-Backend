import { ApplicationStatus } from '@prisma/client';
import { ApplicationQueueService } from './application-queue.service';

function mockPrisma() {
  return {
    academicYear: { findFirst: jest.fn() },
    application: { findMany: jest.fn() },
    enrolment: { groupBy: jest.fn() },
  } as any;
}

describe('ApplicationQueueService', () => {
  it('uses active enrolments from the open term when checking capacity', async () => {
    const prisma = mockPrisma();
    prisma.academicYear.findFirst.mockResolvedValue({
      id: 'year-1',
      name: '2026/2027',
      terms: [{ id: 'term-2', code: 'T2', name: 'Second Term', startsAt: new Date('2027-01-01'), endsAt: new Date('2027-03-31') }],
      classes: [{ id: 'class-a', name: 'Business A', level: 'SHS1', programme: 'BUSINESS', division: 'A', room: null, capacity: 2 }],
    });
    prisma.application.findMany.mockResolvedValue([{
      id: 'app-1', trackingCode: 'BCI-1', firstName: 'Ama', lastName: 'Mensah', dob: new Date('2010-01-01'),
      levelApplied: 'SHS1', programmeApplied: 'BUSINESS', guardianName: 'Kwame Mensah', guardianPhone: '0240000000',
      status: ApplicationStatus.UNDER_REVIEW, submittedAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-01'),
    }]);
    prisma.enrolment.groupBy.mockResolvedValue([{ termId: 'term-2', classId: 'class-a', _count: { _all: 1 } }]);

    const result = await new ApplicationQueueService(prisma).getQueue();

    expect(result[0].readiness.placementOptions[0]).toMatchObject({
      termId: 'term-2', classId: 'class-a', occupied: 1, remaining: 1, available: true,
    });
  });

  it('does not offer a class when level or programme does not match', async () => {
    const prisma = mockPrisma();
    prisma.academicYear.findFirst.mockResolvedValue({
      id: 'year-1',
      name: '2026/2027',
      terms: [{ id: 'term-1', code: 'T1', name: 'First Term', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-15') }],
      classes: [{ id: 'class-a', name: 'Arts A', level: 'SHS1', programme: 'GENERAL_ARTS', division: 'A', room: null, capacity: 30 }],
    });
    prisma.application.findMany.mockResolvedValue([{
      id: 'app-1', trackingCode: 'BCI-2', firstName: 'Yaw', lastName: 'Owusu', dob: new Date('2010-01-01'),
      levelApplied: 'SHS1', programmeApplied: 'BUSINESS', guardianName: 'Efua Owusu', guardianPhone: '0241111111',
      status: ApplicationStatus.PENDING, submittedAt: new Date('2026-09-02'), updatedAt: new Date('2026-09-02'),
    }]);
    prisma.enrolment.groupBy.mockResolvedValue([]);

    const result = await new ApplicationQueueService(prisma).getQueue();

    expect(result[0].readiness.placementOptions).toHaveLength(0);
    expect(result[0].readiness.readyForPlacement).toBe(false);
  });
});
