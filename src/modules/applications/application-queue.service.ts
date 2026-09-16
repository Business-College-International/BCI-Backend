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
            include: {
              studentInvoices: false as never,
            },
          },
          classes: {
            orderBy: [{ level: 'asc' }, { programme: 'asc' }, { name: 'asc' }],
            include: { _count: { select: { enrolments: true } } },
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

    return applications.map((application) => {
      const matchingClasses = classes
        .filter((schoolClass) => (
          schoolClass.level === application.levelApplied &&
          schoolClass.programme === application.programmeApplied &&
          (schoolClass.capacity === null || schoolClass._count.enrolments < schoolClass.capacity)
        ))
        .map((schoolClass) => ({
          id: schoolClass.id,
          name: schoolClass.name,
          level: schoolClass.level,
          programme: schoolClass.programme,
          division: schoolClass.division,
          room: schoolClass.room,
          capacity: schoolClass.capacity,
          occupied: schoolClass._count.enrolments,
          remaining: schoolClass.capacity === null ? null : schoolClass.capacity - schoolClass._count.enrolments,
        }));

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
          openTerms: openTerms.map((term) => ({
            id: term.id,
            code: term.code,
            name: term.name,
            startsAt: term.startsAt,
            endsAt: term.endsAt,
          })),
          matchingClasses,
          readyForPlacement: openTerms.length > 0 && matchingClasses.length > 0,
        },
      };
    });
  }
}
