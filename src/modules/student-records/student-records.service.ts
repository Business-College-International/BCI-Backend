import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { StudentDocumentDto } from './dto/student-document.dto';

const STAFF_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT]);

@Injectable()
export class StudentRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  async listDocuments(studentId: string, userId: string, roles: RoleName[]) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, guardians: { select: { guardian: { select: { userId: true } }, canViewAcademic: true } } },
    });
    if (!student) throw new NotFoundException('Student not found.');

    const privileged = roles.some((role) => STAFF_ROLES.has(role));
    const linkedGuardian = student.guardians.find((link) => link.guardian.userId === userId && link.canViewAcademic);
    const isTeacher = roles.includes(RoleName.TEACHER);

    if (!privileged && !linkedGuardian && !isTeacher) throw new ForbiddenException('Document access is restricted.');

    return this.prisma.studentDocument.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, fileUrl: true, createdAt: true },
    });
  }

  async addDocument(studentId: string, actorUserId: string, roles: RoleName[], dto: StudentDocumentDto) {
    if (!roles.some((role) => STAFF_ROLES.has(role))) throw new ForbiddenException('Only authorized school staff can add student documents.');
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) throw new NotFoundException('Student not found.');

    return this.prisma.$transaction(async (tx) => {
      const document = await tx.studentDocument.create({ data: { studentId, type: dto.type.trim(), fileUrl: dto.fileUrl.trim() } });
      await tx.auditLog.create({ data: { actorUserId, action: 'CREATE', entityType: 'StudentDocument', entityId: document.id, afterJson: { studentId, type: document.type, fileUrl: document.fileUrl } } });
      return document;
    });
  }

  async removeDocument(documentId: string, actorUserId: string, roles: RoleName[]) {
    if (!roles.some((role) => STAFF_ROLES.has(role))) throw new ForbiddenException('Only authorized school staff can remove student documents.');
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.studentDocument.findUnique({ where: { id: documentId } });
      if (!document) throw new NotFoundException('Student document not found.');
      await tx.studentDocument.delete({ where: { id: documentId } });
      await tx.auditLog.create({ data: { actorUserId, action: 'DELETE', entityType: 'StudentDocument', entityId: document.id, beforeJson: { studentId: document.studentId, type: document.type, fileUrl: document.fileUrl } } });
      return { success: true };
    });
  }
}
