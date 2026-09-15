import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';

function makePrisma() {
  return {
    staff: { findUnique: jest.fn() },
    teacherAssignment: { findUnique: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('teacher assignment management', () => {
  it('lists filtered assignments for one staff member', async () => {
    const prisma = makePrisma();
    prisma.staff.findUnique.mockResolvedValue({ personId: 'staff-1' });
    prisma.teacherAssignment.findMany.mockResolvedValue([{ id: 'assignment-1' }]);
    const service = new StaffService(prisma as never);

    await expect(service.listTeacherAssignmentsForStaff('staff-1', { termId: 'term-1', classId: 'class-1' })).resolves.toEqual([{ id: 'assignment-1' }]);
    expect(prisma.teacherAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { staffId: 'staff-1', termId: 'term-1', classId: 'class-1' },
    }));
  });

  it('lists all assignments with filters', async () => {
    const prisma = makePrisma();
    prisma.teacherAssignment.findMany.mockResolvedValue([{ id: 'assignment-1' }, { id: 'assignment-2' }]);
    const service = new StaffService(prisma as never);

    await expect(service.listAllTeacherAssignments({ subjectId: 'subject-1' })).resolves.toHaveLength(2);
    expect(prisma.teacherAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { subjectId: 'subject-1' } }));
  });

  it('blocks unassignment in a closed term', async () => {
    const prisma = makePrisma();
    prisma.teacherAssignment.findUnique.mockResolvedValue({ id: 'assignment-1', term: { status: 'CLOSED' }, staff: { personId: 'staff-1' } });
    const service = new StaffService(prisma as never);

    await expect(service.removeTeacherAssignment('assignment-1', 'office-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.teacherAssignment.delete).not.toHaveBeenCalled();
  });

  it('returns not found when unassigning a missing assignment', async () => {
    const prisma = makePrisma();
    prisma.teacherAssignment.findUnique.mockResolvedValue(null);
    const service = new StaffService(prisma as never);

    await expect(service.removeTeacherAssignment('missing', 'office-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
