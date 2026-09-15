import { ForbiddenException } from '@nestjs/common';
import { StudentRecordsService } from './student-records.service';

describe('StudentRecordsService', () => {
  it('rejects an unrelated teacher from student documents', async () => {
    const prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', guardians: [], enrolments: [{ classId: 'class-1', termId: 'term-1' }] }) },
      staff: { findUnique: jest.fn().mockResolvedValue({ personId: 'teacher-1' }) },
      teacherAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
      studentDocument: { findMany: jest.fn() },
    } as any;
    const service = new StudentRecordsService(prisma);

    await expect(service.listDocuments('student-1', 'teacher-user', ['TEACHER'] as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.studentDocument.findMany).not.toHaveBeenCalled();
  });

  it('allows a linked guardian only when academic access is enabled', async () => {
    const prisma = {
      student: { findUnique: jest.fn().mockResolvedValue({ id: 'student-1', guardians: [{ guardian: { userId: 'guardian-user' }, canViewAcademic: true }], enrolments: [] }) },
      studentDocument: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new StudentRecordsService(prisma);

    await service.listDocuments('student-1', 'guardian-user', ['GUARDIAN'] as any);
    expect(prisma.studentDocument.findMany).toHaveBeenCalled();
  });
});
