import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AssignElectiveDto } from './dto/assign-elective.dto';
import { ProgressStudentDto } from './dto/progress-student.dto';

@Injectable()
export class StudentLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async assignElective(studentId: string, actorUserId: string, dto: AssignElectiveDto) {
    return this.prisma.$transaction(async (tx) => {
      const [student, enrolment, subject] = await Promise.all([
        tx.student.findUnique({ where: { id: studentId }, select: { id: true, status: true } }),
        tx.enrolment.findFirst({ where: { studentId, termId: dto.termId, status: 'ACTIVE' } }),
        tx.subject.findUnique({ where: { id: dto.subjectId } }),
      ]);
      if (!student) throw new NotFoundException('Student not found.');
      if (student.status !== 'ACTIVE') throw new ConflictException('Only active students can receive elective assignments.');
      if (!enrolment) throw new BadRequestException('Student has no active enrolment for the selected term.');
      if (!subject) throw new NotFoundException('Subject not found.');
      if (!subject.isActive || !subject.isElective) throw new BadRequestException('Selected subject is not an active elective.');
      if (subject.level !== enrolment.level) throw new BadRequestException('Elective subject level does not match the student enrolment.');
      if (enrolment.programme !== 'NONE' && subject.programme !== 'NONE' && subject.programme !== enrolment.programme) {
        throw new BadRequestException('Elective subject is not valid for the student programme.');
      }
      const existing = await tx.studentElective.findFirst({ where: { enrolmentId: enrolment.id, subjectId: subject.id } });
      if (existing) throw new ConflictException('Student is already assigned to this elective for the selected term.');

      const elective = await tx.studentElective.create({ data: { enrolmentId: enrolment.id, studentId, subjectId: subject.id } });
      await tx.auditLog.create({
        data: { actorUserId, action: 'CREATE', entityType: 'StudentElective', entityId: elective.id, afterJson: { studentId, enrolmentId: enrolment.id, termId: dto.termId, subjectId: subject.id } },
      });
      return elective;
    });
  }

  async removeElective(studentId: string, subjectId: string, termId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const enrolment = await tx.enrolment.findFirst({ where: { studentId, termId }, select: { id: true } });
      if (!enrolment) throw new NotFoundException('Student enrolment for the selected term was not found.');
      const elective = await tx.studentElective.findFirst({ where: { enrolmentId: enrolment.id, subjectId } });
      if (!elective) throw new NotFoundException('Student elective assignment was not found.');
      await tx.studentElective.delete({ where: { id: elective.id } });
      await tx.auditLog.create({
        data: { actorUserId, action: 'DELETE', entityType: 'StudentElective', entityId: elective.id, beforeJson: { studentId, enrolmentId: enrolment.id, termId, subjectId } },
      });
      return { success: true };
    });
  }

  async progressStudent(studentId: string, actorUserId: string, dto: ProgressStudentDto) {
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        include: { enrolments: { where: { status: 'ACTIVE' }, orderBy: { enrolledAt: 'desc' }, take: 1, include: { term: true } } },
      });
      if (!student) throw new NotFoundException('Student not found.');
      if (student.status !== 'ACTIVE') throw new ConflictException('Only active students can be progressed.');
      const current = student.enrolments[0];
      if (!current) throw new ConflictException('Student has no active enrolment to progress.');

      const [targetTerm, targetClass] = await Promise.all([
        tx.term.findUnique({ where: { id: dto.targetTermId }, include: { academicYear: true } }),
        tx.schoolClass.findUnique({ where: { id: dto.targetClassId } }),
      ]);
      if (!targetTerm) throw new NotFoundException('Target term not found.');
      if (!targetClass) throw new NotFoundException('Target class not found.');
      if (targetTerm.id === current.termId || targetTerm.startsAt < current.term.endsAt) {
        throw new BadRequestException('Target term must begin after the current term ends.');
      }
      if (targetClass.academicYearId !== targetTerm.academicYearId) throw new BadRequestException('Target class must belong to the target term academic year.');
      if (targetClass.level !== dto.targetLevel || targetClass.programme !== dto.targetProgramme) throw new BadRequestException('Target class does not match the requested progression level/programme.');
      if (targetClass.capacity !== null) {
        const occupied = await tx.enrolment.count({ where: { classId: targetClass.id, termId: targetTerm.id, status: 'ACTIVE' } });
        if (occupied >= targetClass.capacity) throw new ConflictException('Target class is at capacity.');
      }

      const existing = await tx.enrolment.findUnique({ where: { studentId_termId: { studentId, termId: targetTerm.id } } });
      if (existing) throw new ConflictException('Student already has an enrolment for the target term.');

      await tx.enrolment.update({ where: { id: current.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      const created = await tx.enrolment.create({
        data: {
          studentId,
          academicYearId: targetTerm.academicYearId,
          termId: targetTerm.id,
          classId: targetClass.id,
          level: dto.targetLevel,
          programme: dto.targetProgramme,
          status: 'ACTIVE',
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'Enrolment',
          entityId: created.id,
          beforeJson: { previousEnrolmentId: current.id, previousTermId: current.termId, previousClassId: current.classId, previousLevel: current.level, previousProgramme: current.programme },
          afterJson: { newEnrolmentId: created.id, targetTermId: targetTerm.id, targetClassId: targetClass.id, targetLevel: created.level, targetProgramme: created.programme, reason: dto.reason?.trim() ?? null },
        },
      });
      return { previousEnrolmentId: current.id, enrolment: created };
    });
  }
}
