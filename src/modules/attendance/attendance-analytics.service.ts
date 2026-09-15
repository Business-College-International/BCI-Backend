import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const PRIVILEGED_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
]);

@Injectable()
export class AttendanceAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getClassSummary(
    classId: string,
    termId: string,
    actorUserId: string,
    roles: RoleName[],
  ) {
    const scope = await this.assertClassScope(classId, termId, actorUserId, roles);
    const [term, schoolClass, enrolments, sessions] = await Promise.all([
      this.prisma.term.findUnique({ where: { id: termId }, select: { id: true, code: true, name: true, startsAt: true, endsAt: true } }),
      this.prisma.schoolClass.findUnique({ where: { id: classId }, select: { id: true, name: true, level: true, programme: true } }),
      this.prisma.enrolment.findMany({
        where: { classId, termId, status: 'ACTIVE' },
        select: { studentId: true, student: { select: { id: true, admissionNumber: true, firstName: true, lastName: true } } },
        orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      }),
      this.prisma.attendanceSession.findMany({
        where: { classId, termId },
        select: { id: true, sessionDate: true, subjectId: true, subject: { select: { code: true, name: true } } },
        orderBy: { sessionDate: 'asc' },
      }),
    ]);

    if (!term || !schoolClass) throw new NotFoundException('Class or term not found.');

    const records = sessions.length === 0
      ? []
      : await this.prisma.attendanceRecord.findMany({
          where: { sessionId: { in: sessions.map((session) => session.id) }, studentId: { in: enrolments.map((e) => e.studentId) } },
          select: { sessionId: true, studentId: true, status: true },
        });

    const byStudent = new Map<string, Record<string, number>>();
    for (const enrolment of enrolments) {
      byStudent.set(enrolment.studentId, { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 });
    }
    for (const record of records) {
      const counts = byStudent.get(record.studentId);
      if (counts) counts[record.status] = (counts[record.status] ?? 0) + 1;
    }

    const students = enrolments.map((enrolment) => {
      const counts = byStudent.get(enrolment.studentId)!;
      const totalMarked = counts.PRESENT + counts.ABSENT + counts.LATE + counts.EXCUSED;
      const attended = counts.PRESENT + counts.LATE;
      return {
        student: enrolment.student,
        counts,
        totalMarked,
        attendanceRate: totalMarked > 0 ? Number(((attended / totalMarked) * 100).toFixed(2)) : null,
      };
    });

    const totals = students.reduce(
      (acc, student) => {
        acc.present += student.counts.PRESENT;
        acc.absent += student.counts.ABSENT;
        acc.late += student.counts.LATE;
        acc.excused += student.counts.EXCUSED;
        return acc;
      },
      { present: 0, absent: 0, late: 0, excused: 0 },
    );
    const totalMarked = totals.present + totals.absent + totals.late + totals.excused;

    return {
      scope,
      class: schoolClass,
      term,
      sessionCount: sessions.length,
      totals: {
        ...totals,
        totalMarked,
        attendanceRate: totalMarked > 0 ? Number((((totals.present + totals.late) / totalMarked) * 100).toFixed(2)) : null,
      },
      students,
    };
  }

  async getChronicAbsence(
    classId: string,
    termId: string,
    actorUserId: string,
    roles: RoleName[],
    absenceRateThreshold = 0.2,
    minimumSessions = 5,
  ) {
    if (absenceRateThreshold <= 0 || absenceRateThreshold >= 1) {
      throw new BadRequestException('Absence-rate threshold must be greater than 0 and less than 1.');
    }
    if (!Number.isInteger(minimumSessions) || minimumSessions < 1) {
      throw new BadRequestException('Minimum sessions must be a positive whole number.');
    }

    const summary = await this.getClassSummary(classId, termId, actorUserId, roles);
    const flagged = summary.students
      .filter((student) => {
        const totalMarked = student.totalMarked;
        if (totalMarked < minimumSessions) return false;
        const absenceRate = student.counts.ABSENT / totalMarked;
        return absenceRate >= absenceRateThreshold;
      })
      .map((student) => ({
        ...student,
        absenceRate: Number(((student.counts.ABSENT / student.totalMarked) * 100).toFixed(2)),
      }))
      .sort((a, b) => b.absenceRate - a.absenceRate);

    return {
      class: summary.class,
      term: summary.term,
      policy: { absenceRateThreshold: Number((absenceRateThreshold * 100).toFixed(2)), minimumSessions },
      flaggedCount: flagged.length,
      flagged,
    };
  }

  private async assertClassScope(classId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    const schoolClass = await this.prisma.schoolClass.findUnique({ where: { id: classId }, select: { id: true, academicYearId: true } });
    const term = await this.prisma.term.findUnique({ where: { id: termId }, select: { id: true, academicYearId: true } });
    if (!schoolClass || !term) throw new NotFoundException('Class or term not found.');
    if (schoolClass.academicYearId !== term.academicYearId) {
      throw new BadRequestException('The class and term do not belong to the same academic year.');
    }
    if (roles.some((role) => PRIVILEGED_ROLES.has(role))) return 'PRIVILEGED';
    if (!roles.includes(RoleName.TEACHER)) throw new ForbiddenException('Attendance analytics requires teacher or privileged school access.');

    const staff = await this.prisma.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!staff) throw new ForbiddenException('Teacher access requires an active staff link.');
    const assignment = await this.prisma.teacherAssignment.findFirst({
      where: { staffId: staff.personId, classId, termId },
      select: { id: true },
    });
    if (!assignment) throw new ForbiddenException('You are not assigned to this class for the selected term.');
    return 'TEACHER_ASSIGNMENT';
  }
}
