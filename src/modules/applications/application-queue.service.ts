import { Injectable } from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ApplicationQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async getQueue() {
    const [academicYear, applications] = await Promise.all([
      this.prisma.academicYear.findFirst({
        where: { isCurrent: true },
        include: {
          terms: {
            where: { status: 'OPEN' },
            orderBy: { startsAt: 'asc' },
          },
          classes: {
            orderBy: [{ level: 'asc' }, { programme: 'asc' }, { name: 'asc' }],
          },
        },
      }),
      this.prisma.application.findMany({
        where: { status: { in: [ApplicationStatus.PENDING, ApplicationStatus.UNDER_REVIEW] } },
        orderBy: { submittedAt: 'asc' },
        take: 250,
      }),
    ]);

    const openTerms = academicYear?.terms ?? [];
    const classes = academicYear?.classes ?? [];
    const occupancy = openTerms.length && classes.length
      ? await this.prisma.enrolment.groupBy({
          by: ['termId', 'classId'],
          where: {
            termId: { in: openTerms.map((term) => term.id) },
            classId: { in: classes.map((schoolClass) => schoolClass.id) },
            status: 'ACTIVE',
          },
          _count: { _all: true },
        })
      : [];

    const occupancyMap = new Map(
      occupancy.map((entry) => [`${entry.termId}:${entry.classId}`, entry._count._all]),
    );

    return applications.map((application) => {
      const placementOptions = openTerms.flatMap((term) =>
        classes
          .filter((schoolClass) => (
            schoolClass.level === application.levelApplied &&
            schoolClass.programme === application.programmeApplied
          ))
          .map((schoolClass) => {
            const occupied = occupancyMap.get(`${term.id}:${schoolClass.id}`) ?? 0;
            const remaining = schoolClass.capacity === null
              ? null
              : Math.max(schoolClass.capacity - occupied, 0);

            return {
              termId: term.id,
              termCode: term.code,
              termName: term.name,
              termStartsAt: term.startsAt,
              termEndsAt: term.endsAt,
              classId: schoolClass.id,
              className: schoolClass.name,
              level: schoolClass.level,
              programme: schoolClass.programme,
              division: schoolClass.division,
              room: schoolClass.room,
              capacity: schoolClass.capacity,
              occupied,
              remaining,
              available: schoolClass.capacity === null || occupied < schoolClass.capacity,
            };
          }),
      );

      const availablePlacements = placementOptions.filter((option) => option.available);

      return {
        id: application.id,
        trackingCode: application.trackingCode,
        firstName: application.firstName,
        lastName: application.lastName,
        dob: application.dob,
        levelApplied: application.levelApplied,
        programmeApplied: application.programmeApplied,
        guardianName: application.guardianName,
        guardianPhone: application.guardianPhone,
        status: application.status,
        submittedAt: application.submittedAt,
        updatedAt: application.updatedAt,
        readiness: {
          currentAcademicYearId: academicYear?.id ?? null,
          currentAcademicYearName: academicYear?.name ?? null,
          openTermCount: openTerms.length,
          placementOptions,
          availablePlacementCount: availablePlacements.length,
          readyForPlacement: availablePlacements.length > 0,
        },
      };
    });
  }
}
