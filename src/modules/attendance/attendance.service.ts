import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateAttendanceSessionDto } from './dto/create-attendance-session.dto';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';

const PRIVILEGED_ATTENDANCE_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
]);

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(dto: CreateAttendanceSessionDto, actorUserId: string, roles: RoleName[]) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the class row so concurrent session creation for the same class
      // cannot both pass the duplicate-session check before either commits.
      await tx.$queryRaw`SELECT id FROM "SchoolClass" WHERE id = ${dto.classId} FOR UPDATE`;

      const [term, schoolClass] = await Promise.all([
        tx.term.findUnique({ where: { id: dto.termId } }),
        tx.schoolClass.findUnique({ where: { id: dto.classId } }),
      ]);

      if (!term || !schoolClass) throw new NotFoundException('Term or class not found.');
      if (schoolClass.academicYearId !== term.academicYearId) {
        throw new BadRequestException('The class does not belong to the selected term academic year.');
      }

      const sessionDate = new Date(dto.sessionDate);
      if (sessionDate < term.startsAt || sessionDate > term.endsAt) {
        throw new BadRequestException('The attendance session date must fall within the selected term.');
      }
      if (term.status === 'CLOSED') {
        throw new BadRequestException('Attendance cannot be opened for a closed term.');
      }
      if (dto.startsAt && dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt)) {
        throw new BadRequestException('Attendance session end must be after its start.');
      }

      const privileged = roles.some((role) => PRIVILEGED_ATTENDANCE_ROLES.has(role));
      const staff = await tx.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });

      if (!privileged) {
        if (!roles.includes(RoleName.TEACHER) || !staff) {
          throw new ForbiddenException('Attendance session creation requires an assigned teacher or privileged school role.');
        }

        const assignment = await tx.teacherAssignment.findFirst({
          where: {
            staffId: staff.personId,
            classId: dto.classId,
            termId: dto.termId,
            ...(dto.subjectId ? { subjectId: dto.subjectId } : {}),
          },
          select: { id: true },
        });
        if (!assignment) {
          throw new ForbiddenException('You are not assigned to this class/subject for the selected term.');
        }
      }

      const normalizedPeriodLabel = dto.periodLabel?.trim() || null;
      const existingSession = await tx.attendanceSession.findFirst({
        where: {
          termId: dto.termId,
          classId: dto.classId,
          subjectId: dto.subjectId ?? null,
          sessionDate,
          periodLabel: normalizedPeriodLabel,
        },
        select: { id: true },
      });
      if (existingSession) {
        throw new ConflictException('An attendance session already exists for this class, subject, date, and period.');
      }

      if (dto.subjectId) {
        const subject = await tx.subject.findUnique({ where: { id: dto.subjectId } });
        if (!subject) throw new NotFoundException('Subject not found.');
        if (subject.level !== schoolClass.level) {
          throw new BadRequestException('The subject level does not match the class level.');
        }
      }

      const session = await tx.attendanceSession.create({
        data: {
          termId: dto.termId,
          classId: dto.classId,
          subjectId: dto.subjectId,
          teacherId: staff?.personId,
          sessionDate,
          periodLabel: normalizedPeriodLabel,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'AttendanceSession',
          entityId: session.id,
          afterJson: {
            termId: session.termId,
            classId: session.classId,
            subjectId: session.subjectId,
            sessionDate: session.sessionDate.toISOString(),
          },
        },
      });

      return session;
    });
  }

  async getSessionRoster(sessionId: string, actorUserId: string, roles: RoleName[]) {
    const session = await this.prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { class: { select: { id: true, name: true } }, records: true },
    });
    if (!session) throw new NotFoundException('Attendance session not found.');

    await this.assertSessionAccess(
      this.prisma,
      session.classId,
      session.termId,
      session.subjectId,
      actorUserId,
      roles,
    );

    const enrolments = await this.prisma.enrolment.findMany({
      where: { classId: session.classId, termId: session.termId, status: 'ACTIVE' },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      select: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            passportPhotoUrl: true,
            status: true,
          },
        },
      },
    });

    const records = new Map(session.records.map((record) => [record.studentId, record]));

    return {
      session: {
        id: session.id,
        class: session.class,
        termId: session.termId,
        subjectId: session.subjectId,
        sessionDate: session.sessionDate,
        periodLabel: session.periodLabel,
      },
      roster: enrolments.map(({ student }) => {
        const record = records.get(student.id);
        return {
          student,
          attendance: record
            ? { status: record.status, note: record.note, markedAt: record.markedAt }
            : null,
        };
      }),
    };
  }

  async markAttendance(sessionId: string, dto: MarkAttendanceDto, actorUserId: string, roles: RoleName[]) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.attendanceSession.findUnique({
        where: { id: sessionId },
        include: { term: { select: { status: true } } },
      });
      if (!session) throw new NotFoundException('Attendance session not found.');
      if (session.term.status === 'CLOSED') {
        throw new BadRequestException('Attendance cannot be changed after the term is closed.');
      }

      await this.assertSessionAccess(tx, session.classId, session.termId, session.subjectId, actorUserId, roles);

      const ids = dto.records.map((record) => record.studentId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate student IDs are not allowed.');

      const enrolments = await tx.enrolment.findMany({
        where: {
          studentId: { in: ids },
          classId: session.classId,
          termId: session.termId,
          status: 'ACTIVE',
        },
        select: { studentId: true },
      });
      const validStudents = new Set(enrolments.map((enrolment) => enrolment.studentId));
      const invalid = ids.filter((id) => !validStudents.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException('Every marked student must have an active enrolment in the session class and term.');
      }

      for (const record of dto.records) {
        await tx.attendanceRecord.upsert({
          where: { sessionId_studentId: { sessionId, studentId: record.studentId } },
          create: {
            sessionId,
            studentId: record.studentId,
            status: record.status,
            markedBy: actorUserId,
            note: record.note?.trim(),
          },
          update: {
            status: record.status,
            markedBy: actorUserId,
            markedAt: new Date(),
            note: record.note?.trim(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'AttendanceSession',
          entityId: sessionId,
          afterJson: {
            recordCount: dto.records.length,
            statusCounts: dto.records.reduce<Record<string, number>>((counts, record) => {
              counts[record.status] = (counts[record.status] ?? 0) + 1;
              return counts;
            }, {}),
          },
        },
      });

      return tx.attendanceRecord.findMany({
        where: { sessionId },
        orderBy: { studentId: 'asc' },
      });
    });
  }

  async getStudentAttendance(studentId: string, actorUserId: string, roles: RoleName[], termId?: string) {
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) throw new NotFoundException('Student not found.');

    const scope = await this.resolveStudentScope(studentId, actorUserId, roles, termId);
    if (!scope.allowed) throw new ForbiddenException('You do not have access to this student attendance.');
    if (scope.isGuardian && !scope.canViewAcademic) {
      throw new ForbiddenException('This guardian is not permitted to view academic records for this ward.');
    }

    const sessions = await this.prisma.attendanceSession.findMany({
      where: {
        ...(termId ? { termId } : {}),
        records: { some: { studentId } },
      },
      include: {
        subject: { select: { code: true, name: true } },
        records: { where: { studentId }, select: { status: true, markedAt: true, note: true } },
      },
      orderBy: { sessionDate: 'desc' },
    });

    const counts = sessions.reduce<Record<string, number>>((summary, session) => {
      const status = session.records[0]?.status;
      if (status) summary[status] = (summary[status] ?? 0) + 1;
      return summary;
    }, {});

    return {
      summary: {
        present: counts[AttendanceStatus.PRESENT] ?? 0,
        absent: counts[AttendanceStatus.ABSENT] ?? 0,
        late: counts[AttendanceStatus.LATE] ?? 0,
        excused: counts[AttendanceStatus.EXCUSED] ?? 0,
        total: sessions.length,
      },
      sessions: sessions.map((session) => ({
        id: session.id,
        sessionDate: session.sessionDate,
        periodLabel: session.periodLabel,
        subject: session.subject,
        status: session.records[0]?.status ?? null,
        note: session.records[0]?.note ?? null,
      })),
    };
  }

  private async assertSessionAccess(
    tx: Prisma.TransactionClient,
    classId: string,
    termId: string,
    subjectId: string | null,
    actorUserId: string,
    roles: RoleName[],
  ) {
    if (roles.some((role) => PRIVILEGED_ATTENDANCE_ROLES.has(role))) return;
    if (!roles.includes(RoleName.TEACHER)) throw new ForbiddenException('Teacher attendance access is required.');

    const staff = await tx.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!staff) throw new ForbiddenException('Teacher access requires an active staff link.');

    const assignment = await tx.teacherAssignment.findFirst({
      where: {
        staffId: staff.personId,
        classId,
        termId,
        ...(subjectId ? { subjectId } : {}),
      },
      select: { id: true },
    });
    if (!assignment) throw new ForbiddenException('You are not assigned to this attendance class/subject for the term.');
  }

  private async resolveStudentScope(studentId: string, actorUserId: string, roles: RoleName[], requestedTermId?: string) {
    if (roles.some((role) => PRIVILEGED_ATTENDANCE_ROLES.has(role))) {
      return { allowed: true, isGuardian: false, canViewAcademic: true };
    }

    const guardian = await this.prisma.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (guardian) {
      const link = await this.prisma.guardianStudent.findUnique({
        where: { guardianId_studentId: { guardianId: guardian.personId, studentId } },
        select: { canViewAcademic: true },
      });
      if (link) return { allowed: true, isGuardian: true, canViewAcademic: link.canViewAcademic };
    }

    if (roles.includes(RoleName.TEACHER)) {
      const activeEnrolment = await this.prisma.enrolment.findFirst({
        where: { studentId, status: 'ACTIVE', ...(requestedTermId ? { termId: requestedTermId } : {}) },
        select: { classId: true, termId: true },
        orderBy: { enrolledAt: 'desc' },
      });
      if (!activeEnrolment) return { allowed: false, isGuardian: false, canViewAcademic: false };
      const staff = await this.prisma.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
      if (!staff) return { allowed: false, isGuardian: false, canViewAcademic: false };
      const assignment = await this.prisma.teacherAssignment.findFirst({
        where: { staffId: staff.personId, classId: activeEnrolment.classId, termId: activeEnrolment.termId },
        select: { id: true },
      });
      if (assignment) return { allowed: true, isGuardian: false, canViewAcademic: true };
    }

    return { allowed: false, isGuardian: false, canViewAcademic: false };
  }
}
