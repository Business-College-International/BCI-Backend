import { TimetableService } from './timetable.service';

describe('TimetableService', () => {
  it('detects teacher, class and room conflicts', async () => {
    const assignments = [
      { id: 'a1', termId: 't1', staffId: 'teacher-1', classId: 'class-1', class: { name: 'General Arts A' }, subject: { code: 'ENG', name: 'English' } },
      { id: 'a2', termId: 't1', staffId: 'teacher-1', classId: 'class-2', class: { name: 'General Arts B' }, subject: { code: 'MATH', name: 'Mathematics' } },
      { id: 'a3', termId: 't1', staffId: 'teacher-2', classId: 'class-1', class: { name: 'General Arts A' }, subject: { code: 'BIO', name: 'Biology' } },
    ];
    const prisma = { teacherAssignment: { findMany: jest.fn().mockResolvedValue(assignments) } } as any;
    const service = new TimetableService(prisma);

    const result = await service.validateDraft('t1', [
      { assignmentId: 'a1', dayOfWeek: 1, startsAt: '09:00', endsAt: '10:00', room: 'R1' },
      { assignmentId: 'a2', dayOfWeek: 1, startsAt: '09:30', endsAt: '10:30', room: 'R1' },
      { assignmentId: 'a3', dayOfWeek: 1, startsAt: '09:45', endsAt: '10:15', room: 'R2' },
    ]);

    expect(result.valid).toBe(false);
    expect(result.conflicts.map((item) => item.type)).toEqual(expect.arrayContaining(['TEACHER_CONFLICT', 'CLASS_CONFLICT', 'ROOM_CONFLICT']));
  });

  it('rejects duplicate assignments, missing rooms and wrong terms', async () => {
    const assignments = [{ id: 'a1', termId: 't1', staffId: 'teacher-1', classId: 'class-1', class: { name: 'Business A' }, subject: { code: 'ACC', name: 'Accounting' } }];
    const prisma = { teacherAssignment: { findMany: jest.fn().mockResolvedValue(assignments) } } as any;
    const service = new TimetableService(prisma);

    const result = await service.validateDraft('t2', [
      { assignmentId: 'a1', dayOfWeek: 0, startsAt: '09:00', endsAt: '09:00' },
      { assignmentId: 'a1', dayOfWeek: 1, startsAt: '09:00', endsAt: '10:00' },
    ]);

    expect(result.valid).toBe(false);
    expect(result.conflicts.map((item) => item.type)).toEqual(expect.arrayContaining(['TERM_MISMATCH', 'INVALID_DAY', 'INVALID_TIME', 'ROOM_REQUIRED', 'DUPLICATE_ASSIGNMENT']));
  });
});
