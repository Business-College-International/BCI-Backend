import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { EnterAssessmentResultsDto } from './dto/enter-assessment-results.dto';

const PRIVILEGED_ASSESSMENT_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
]);

@Injectable()
export class AssessmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createAssessment(dto: CreateAssessmentDto, actorUserId: string, roles: RoleName[]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Term" WHERE id = ${dto.termId} FOR UPDATE`;
      const [term, subject] = await Promise.all([
        tx.term.findUnique({ where: { id: dto.termId } }),
        tx.subject.findUnique({ where: { id: dto.subjectId } }),
      ]);

      if (!term || !subject) throw new NotFoundException('Term or subject not found.');
      if (term.status === 'CLOSED') throw new BadRequestException('Assessments cannot be created for a closed term.');
      if (dto.maxScore <= 0) throw new BadRequestException('Maximum score must be greater than zero.');
      if (dto.weight !== undefined && (dto.weight < 0 || dto.weight > 100)) {
        throw new BadRequestException('Assessment weight must be between 0 and 100.');
      }

      await this.assertTeacherAssignment(tx, actorUserId, roles, dto.termId, dto.subjectId);

      const assessment = await tx.assessment.create({
        data: {
          termId: dto.termId,
          subjectId: dto.subjectId,
          title: dto.title.trim(),
          type: dto.type,
          maxScore: new Prisma.Decimal(dto.maxScore),
          weight: dto.weight === undefined ? undefined : new Prisma.Decimal(dto.weight),
        },
        include: { subject: { select: { code: true, name: true } }, term: { select: { code: true, name: true } } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'Assessment',
          entityId: assessment.id,
          afterJson: {
            termId: assessment.termId,
            subjectId: assessment.subjectId,
            title: assessment.title,
            type: assessment.type,
            maxScore: assessment.maxScore.toString(),
            weight: assessment.weight?.toString() ?? null,
          },
        },
      });

      return assessment;
    });
  }

  async getAssessmentRoster(
    classId: string,
    termId: string,
    subjectId: string,
    actorUserId: string,
    roles: RoleName[],
  ) {
    const [term, schoolClass, subject] = await Promise.all([
      this.prisma.term.findUnique({ where: { id: termId } }),
      this.prisma.schoolClass.findUnique({ where: { id: classId } }),
      this.prisma.subject.findUnique({ where: { id: subjectId } }),
    ]);

    if (!term || !schoolClass || !subject) throw new NotFoundException('Term, class, or subject not found.');
    if (schoolClass.academicYearId !== term.academicYearId) {
      throw new BadRequestException('The class does not belong to the selected term academic year.');
    }
    if (subject.level !== schoolClass.level) {
      throw new BadRequestException('The subject level does not match the class level.');
    }

    await this.assertTeacherAssignmentForClass(this.prisma, actorUserId, roles, termId, subjectId, classId);

    const rows = await this.prisma.enrolment.findMany({
      where: { classId, termId, status: 'ACTIVE' },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      select: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            lastName: true,
            status: true,
          },
        },
      },
    });

    return rows.map(({ student }) => student);
  }

  async listAssignedAssessments(
    classId: string,
    termId: string,
    subjectId: string,
    actorUserId: string,
    roles: RoleName[],
  ) {
    const [term, schoolClass, subject] = await Promise.all([
      this.prisma.term.findUnique({ where: { id: termId }, select: { id: true, status: true, academicYearId: true } }),
      this.prisma.schoolClass.findUnique({ where: { id: classId }, select: { id: true, level: true, academicYearId: true } }),
      this.prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, level: true } }),
    ]);

    if (!term || !schoolClass || !subject) throw new NotFoundException('Term, class, or subject not found.');
    if (schoolClass.academicYearId !== term.academicYearId) {
      throw new BadRequestException('The class does not belong to the selected term academic year.');
    }
    if (subject.level !== schoolClass.level) {
      throw new BadRequestException('The subject level does not match the class level.');
    }

    await this.assertTeacherAssignmentForClass(this.prisma, actorUserId, roles, termId, subjectId, classId);

    const assessments = await this.prisma.assessment.findMany({
      where: { termId, subjectId },
      include: {
        results: {
          where: { student: { enrolments: { some: { classId, termId, status: 'ACTIVE' } } } },
          select: { id: true, studentId: true, score: true, remark: true, enteredAt: true, enteredBy: true },
          orderBy: { studentId: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return assessments.map((assessment) => ({
      id: assessment.id,
      title: assessment.title,
      type: assessment.type,
      maxScore: assessment.maxScore.toString(),
      weight: assessment.weight?.toString() ?? null,
      createdAt: assessment.createdAt,
      results: assessment.results.map((result) => ({
        id: result.id,
        studentId: result.studentId,
        score: result.score.toString(),
        remark: result.remark,
        enteredAt: result.enteredAt,
        enteredBy: result.enteredBy,
      })),
    }));
  }

  async enterResults(assessmentId: string, dto: EnterAssessmentResultsDto, actorUserId: string, roles: RoleName[]) {
    return this.prisma.$transaction(async (tx) => {
      const assessmentTerm = await tx.assessment.findUnique({
        where: { id: assessmentId },
        select: { termId: true },
      });
      if (!assessmentTerm) throw new NotFoundException('Assessment not found.');

      await tx.$queryRaw`SELECT id FROM "Term" WHERE id = ${assessmentTerm.termId} FOR UPDATE`;

      const assessment = await tx.assessment.findUnique({
        where: { id: assessmentId },
        select: { id: true, termId: true, subjectId: true, maxScore: true, term: { select: { status: true } } },
      });
      if (!assessment) throw new NotFoundException('Assessment not found.');
      if (assessment.term.status === 'CLOSED') {
        throw new BadRequestException('Assessment results cannot be entered or changed for a closed term.');
      }

      await this.assertTeacherAssignment(tx, actorUserId, roles, assessment.termId, assessment.subjectId);

      const ids = dto.results.map((result) => result.studentId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate student IDs are not allowed.');

      await this.assertPublishedReportEditAccess(tx, ids, assessment.termId);

      const eligible = await this.findEligibleStudents(tx, ids, assessment.termId, assessment.subjectId, actorUserId, roles);
      const invalid = ids.filter((id) => !eligible.has(id));
      if (invalid.length > 0) {
        throw new BadRequestException('Every result must belong to a student enrolled in a class assigned for this subject and term.');
      }

      for (const result of dto.results) {
        const score = new Prisma.Decimal(result.score);
        if (score.lt(0) || score.gt(assessment.maxScore)) {
          throw new BadRequestException(`Score for student ${result.studentId} must be between 0 and ${assessment.maxScore.toString()}.`);
        }

        await tx.assessmentResult.upsert({
          where: { assessmentId_studentId: { assessmentId, studentId: result.studentId } },
          create: {
            assessmentId,
            studentId: result.studentId,
            score,
            remark: result.remark?.trim(),
            enteredBy: actorUserId,
          },
          update: {
            score,
            remark: result.remark?.trim(),
            enteredBy: actorUserId,
            enteredAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'Assessment',
          entityId: assessmentId,
          afterJson: { resultCount: dto.results.length },
        },
      });

      return tx.assessmentResult.findMany({
        where: { assessmentId },
        orderBy: { studentId: 'asc' },
      });
    });
  }

  async getStudentAssessments(studentId: string, actorUserId: string, roles: RoleName[], termId?: string) {
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) throw new NotFoundException('Student not found.');

    const requestedTermId = termId;
    const guardian = await this.prisma.guardian.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    let allowed = roles.some((role) => PRIVILEGED_ASSESSMENT_ROLES.has(role));
    let guardianRestricted = false;

    if (guardian) {
      const link = await this.prisma.guardianStudent.findUnique({
        where: { guardianId_studentId: { guardianId: guardian.personId, studentId } },
        select: { canViewAcademic: true },
      });
      if (link) {
        allowed = true;
        guardianRestricted = !link.canViewAcademic;
      }
    }

    if (roles.includes(RoleName.TEACHER) && !allowed) {
      const staff = await this.prisma.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
      const enrolment = await this.prisma.enrolment.findFirst({
        where: { studentId, status: 'ACTIVE', ...(requestedTermId ? { termId: requestedTermId } : {}) },
        orderBy: { enrolledAt: 'desc' },
        select: { classId: true, termId: true },
      });
      if (staff && enrolment) {
        const assignment = await this.prisma.teacherAssignment.findFirst({
          where: {
            staffId: staff.personId,
            classId: enrolment.classId,
            termId: enrolment.termId,
          },
          select: { id: true },
        });
        allowed = Boolean(assignment);
      }
    }

    if (!allowed) throw new ForbiddenException('You do not have access to this student assessment record.');
    if (guardianRestricted) throw new ForbiddenException('This guardian is not permitted to view academic records for this ward.');

    const results = await this.prisma.assessmentResult.findMany({
      where: {
        studentId,
        assessment: termId ? { termId } : undefined,
      },
      include: {
        assessment: {
          select: {
            id: true,
            title: true,
            type: true,
            maxScore: true,
            weight: true,
            term: { select: { code: true, name: true } },
            subject: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { enteredAt: 'desc' },
    });

    return results.map((result) => ({
      id: result.id,
      score: result.score.toString(),
      remark: result.remark,
      enteredAt: result.enteredAt,
      assessment: {
        id: result.assessment.id,
        title: result.assessment.title,
        type: result.assessment.type,
        maxScore: result.assessment.maxScore.toString(),
        weight: result.assessment.weight?.toString() ?? null,
        term: result.assessment.term,
        subject: result.assessment.subject,
      },
    }));
  }

  private async assertPublishedReportEditAccess(
    tx: Prisma.TransactionClient,
    studentIds: string[],
    termId: string,
  ) {
    if (studentIds.length === 0) return;

    await tx.$executeRaw`
      SELECT id
      FROM "ReportCardPublication"
      WHERE "termId" = ${termId}
        AND status = 'PUBLISHED'
        AND "studentId" IN (${Prisma.join(studentIds)})
      FOR UPDATE
    `;

    const published = await tx.reportCardPublication.findMany({
      where: { studentId: { in: studentIds }, termId, status: 'PUBLISHED' },
      select: { id: true, studentId: true },
    });
    if (published.length === 0) return;

    const pending = await tx.reportCardCorrectionRequest.findMany({
      where: {
        studentId: { in: published.map((row) => row.studentId) },
        termId,
        targetPublicationId: { in: published.map((row) => row.id) },
        decision: 'PENDING',
      },
      select: { studentId: true, targetPublicationId: true },
    });

    const permitted = new Set(pending.map((row) => row.studentId));
    const blocked = published.filter((row) => !permitted.has(row.studentId));
    if (blocked.length > 0) {
      throw new BadRequestException('Published report cards are read-only. Submit a correction request before changing their assessment results.');
    }
  }
  private async assertTeacherAssignment(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    roles: RoleName[],
    termId: string,
    subjectId: string,
  ) {
    if (roles.some((role) => PRIVILEGED_ASSESSMENT_ROLES.has(role))) return;
    if (!roles.includes(RoleName.TEACHER)) throw new ForbiddenException('Assessment management access is restricted.');

    const staff = await tx.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!staff) throw new ForbiddenException('Teacher access requires an active staff link.');

    const assignment = await tx.teacherAssignment.findFirst({
      where: { staffId: staff.personId, termId, subjectId },
      select: { id: true },
    });
    if (!assignment) throw new ForbiddenException('You are not assigned to this subject for the selected term.');
  }

  private async assertTeacherAssignmentForClass(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    roles: RoleName[],
    termId: string,
    subjectId: string,
    classId: string,
  ) {
    if (roles.some((role) => PRIVILEGED_ASSESSMENT_ROLES.has(role))) return;
    if (!roles.includes(RoleName.TEACHER)) throw new ForbiddenException('Assessment access is restricted.');

    const staff = await tx.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!staff) throw new ForbiddenException('Teacher access requires an active staff link.');

    const assignment = await tx.teacherAssignment.findFirst({
      where: { staffId: staff.personId, termId, subjectId, classId },
      select: { id: true },
    });
    if (!assignment) throw new ForbiddenException('You are not assigned to this class/subject for the selected term.');
  }

  private async findEligibleStudents(
    tx: Prisma.TransactionClient,
    studentIds: string[],
    termId: string,
    subjectId: string,
    actorUserId: string,
    roles: RoleName[],
  ) {
    const enrolments = await tx.enrolment.findMany({
      where: { studentId: { in: studentIds }, termId, status: 'ACTIVE' },
      select: { studentId: true, classId: true },
    });

    if (roles.some((role) => PRIVILEGED_ASSESSMENT_ROLES.has(role))) {
      return new Set(enrolments.map((entry) => entry.studentId));
    }

    const staff = await tx.staff.findUnique({ where: { userId: actorUserId }, select: { personId: true } });
    if (!staff) return new Set<string>();

    const classIds = await tx.teacherAssignment.findMany({
      where: { staffId: staff.personId, termId, subjectId },
      select: { classId: true },
      distinct: ['classId'],
    });
    const allowedClasses = new Set(classIds.map((entry) => entry.classId));
    return new Set(enrolments.filter((entry) => allowedClasses.has(entry.classId)).map((entry) => entry.studentId));
  }
}
