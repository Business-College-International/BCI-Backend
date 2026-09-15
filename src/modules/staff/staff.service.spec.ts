import { BadRequestException } from '@nestjs/common';
import { StaffService } from './staff.service';

function makePrisma() {
  return {
    staff: { findUnique: jest.fn() },
    term: { findUnique: jest.fn() },
    schoolClass: { findUnique: jest.fn() },
    subject: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('StaffService', () => {
  it('rejects a teacher assignment when the class belongs to another academic year', async () => {
    const prisma = makePrisma();
    prisma.staff.findUnique.mockResolvedValue({ personId: 'staff-1' });
    prisma.term.findUnique.mockResolvedValue({ id: 'term-1', academicYearId: 'year-1', status: 'OPEN' });
    prisma.schoolClass.findUnique.mockResolvedValue({ id: 'class-1', academicYearId: 'year-2', level: 'SHS1', programme: 'BUSINESS' });
    prisma.subject.findUnique.mockResolvedValue({ id: 'subject-1', level: 'SHS1', programme: 'BUSINESS' });

    const service = new StaffService(prisma as never);

    await expect(
      service.createTeacherAssignment('staff-1', {
        classId: 'class-1',
        subjectId: 'subject-1',
        termId: 'term-1',
      }, 'office-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
