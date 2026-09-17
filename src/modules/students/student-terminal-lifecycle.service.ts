import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleName, StudentStatus, TermStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { TransferStudentDto } from './dto/transfer-student.dto';

const MANAGEMENT_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);

@Injectable()
export class StudentTerminalLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  private requireManagement(roles: RoleName[]) {
    if (!roles.some((role) => MANAGEMENT_ROLES.has(role))) throw new ForbiddenException('Student lifecycle management is restricted.');
  }

  async history(studentId: string, roles: RoleName[]) {
    this.requireManagement(roles);
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true, admissionNumber: true, firstName: true, lastName: true, status: true, admittedAt: true,
        enrolments: { orderBy: { enrolledAt: 'desc' }, include: { academicYear: { select: { id: true, name: true } }, term: { select: { id: true, code: true, name: true, status: true } }, class: { select: { id: true, name: true, level: true, programme: true } } } },
      },
    });
    if (!student) throw new NotFoundException('Student not found.');
    return student;
  }

  async graduate(studentId: string, actorUserId: string, roles: RoleName) {
    this.requireManagement([roles]);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const student = await tx.student.findUnique({ where: { id: studentId }, include: { enrolments: { where: { status: 'ACTIVE' }, orderBy: { enrolledAt: 'desc' }, take: 1, include: { term: true } } } });
        if (!student) throw new NotFoundException('Student not found.');
        if (student.status !== StudentStatus.ACTIVE) throw new ConflictException('Only an active student can graduate.');
        const enrolment = student.enrolments[0];
        if (!enrolment) throw new ConflictException('Student has no active enrolment.');
        if (enrolment.level !== 'SHS3') throw new ConflictException('Only SHS3 students can graduate.');
        if (enrolment.term.status !== TermStatus.CLOSED) throw new ConflictException('The final term must be closed before graduation.');
        const now = new Date();
        const updatedEnrolment = await tx.enrolment.update({ where: { id: enrolment.id }, data: { status: 'COMPLETED', completedAt: now } });
        const updatedStudent = await tx.student.update({ where: { id: studentId }, data: { status: StudentStatus.GRADUATED } });
        await tx.auditLog.create({ data: { actorUserId, action: 'UPDATE', entityType: 'Student', entityId: studentId, beforeJson: { status: student.status, enrolmentStatus: enrolment.status }, afterJson: { status: updatedStudent.status, enrolmentStatus: updatedEnrolment.status, completedAt: updatedEnrolment.completedAt } } });
        return { student: { id: updatedStudent.id, status: updatedStudent.status }, enrolment: { id: updatedEnrolment.id, status: updatedEnrolment.status, completedAt: updatedEnrolment.completedAt } };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Student lifecycle changed concurrently. Please retry the operation.');
      }
      throw error;
    }
  }

  async transfer(studentId: string, actorUserId: string, roles: RoleName[], dto: TransferStudentDto) {
    this.requireManagement(roles);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const student = await tx.student.findUnique({ where: { id: studentId }, include: { enrolments: { where: { status: 'ACTIVE' }, orderBy: { enrolledAt: 'desc' }, take: 1 } } });
        if (!student) throw new NotFoundException('Student not found.');
        if (student.status !== StudentStatus.ACTIVE) throw new ConflictException('Only an active student can be transferred.');
        const enrolment = student.enrolments[0];
        if (!enrolment) throw new ConflictException('Student has no active enrolment.');
        const now = new Date();
        const destinationSchool = dto.destinationSchool.trim();
        const reason = dto.reason.trim();
        const exitReason = `Transferred to ${destinationSchool}: ${reason}`;
        const updatedEnrolment = await tx.enrolment.update({ where: { id: enrolment.id }, data: { status: 'TRANSFERRED', completedAt: now, exitReason } });
        const updatedStudent = await tx.student.update({ where: { id: studentId }, data: { status: StudentStatus.TRANSFERRED } });
        await tx.auditLog.create({ data: { actorUserId, action: 'UPDATE', entityType: 'Student', entityId: studentId, beforeJson: { status: student.status, enrolmentStatus: enrolment.status }, afterJson: { status: updatedStudent.status, enrolmentStatus: updatedEnrolment.status, destinationSchool, reason } } });
        return { student: { id: updatedStudent.id, status: updatedStudent.status }, enrolment: { id: updatedEnrolment.id, status: updatedEnrolment.status, completedAt: updatedEnrolment.completedAt, exitReason: updatedEnrolment.exitReason } };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Student lifecycle changed concurrently. Please retry the operation.');
      }
      throw error;
    }
  }
}
