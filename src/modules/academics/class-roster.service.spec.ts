import { ForbiddenException } from '@nestjs/common';
import { ClassRosterService } from './class-roster.service';

describe('ClassRosterService', () => {
  it('denies a teacher who is not assigned to the class and term', async () => {
    const prisma = {
      schoolClass: { findUnique: jest.fn().mockResolvedValue({ id: 'class-1', academicYearId: 'year-1' }) },
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', academicYearId: 'year-1' }) },
      staff: { findUnique: jest.fn().mockResolvedValue({ personId: 'staff-1' }) },
      teacherAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const service = new ClassRosterService(prisma as never);
    await expect(service.getRoster('class-1', 'term-1', 'teacher-user', ['TEACHER' as any]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns active enrolments for an authorized teacher', async () => {
    const prisma = {
      schoolClass: { findUnique: jest.fn().mockResolvedValue({ id: 'class-1', name: 'Business A', level: 'SHS1', programme: 'BUSINESS', division: 'A', room: 'R1', capacity: 40, academicYearId: 'year-1' }) },
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', code: 'T1', name: 'Term 1', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-20'), status: 'OPEN', academicYearId: 'year-1' }) },
      staff: { findUnique: jest.fn().mockResolvedValue({ personId: 'staff-1' }) },
      teacherAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'assignment-1' }) },
      enrolment: { findMany: jest.fn().mockResolvedValue([{ id: 'enrol-1', student: { id: 'student-1', admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Mensah', dateOfBirth: new Date('2010-01-01'), sex: 'F', passportPhotoUrl: null, status: 'ACTIVE', guardians: [] } }]) },
    };

    const service = new ClassRosterService(prisma as never);
    const result = await service.getRoster('class-1', 'term-1', 'teacher-user', ['TEACHER' as any]);
    expect(result.count).toBe(1);
    expect(result.students[0].student.admissionNumber).toBe('BCI-001');
  });
});
