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

  async enterResults(assessmentId: string, dto: EnterAssessmentResultsDto, actorUserId: string, roles: RoleName[]) {
    return this.prisma.$transaction(async (tx) => {
      const assessment = await tx.assessment.findUnique({
        where: { id: assessmentId },
        select: { id: true, termId: true, subjectId: true, maxScore: true },
      });
      if (!assessment) throw new NotFoundException('Assessment not found.');

      await this.assertTeacherAssignment(tx, actorUserId, roles, assessment.termId, assessment.subjectId);

      const ids = dto.results.map((result) => result.studentId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate student IDs are not allowed.');

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
        where: { studentId, status: 'ACTIVE' },
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

  private async assertTeacherAssignment(
    tx: PrismaService,
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

  private async findEligibleStudents(
    tx: PrismaService,
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
