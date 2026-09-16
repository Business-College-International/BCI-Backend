import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TimetableConflict, TimetableSlotInput, TimetableValidationResult } from './timetable.types';

function toMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return -1;
  return hours * 60 + minutes;
}

function overlaps(a: TimetableSlotInput, b: TimetableSlotInput): boolean {
  if (a.dayOfWeek !== b.dayOfWeek) return false;
  const aStart = toMinutes(a.startsAt);
  const aEnd = toMinutes(a.endsAt);
  const bStart = toMinutes(b.startsAt);
  const bEnd = toMinutes(b.endsAt);
  return aStart < bEnd && bStart < aEnd;
}

@Injectable()
export class TimetableService {
  constructor(private readonly prisma: PrismaService) {}

  async validateDraft(termId: string, slots: TimetableSlotInput[]): Promise<TimetableValidationResult> {
    if (!termId.trim()) throw new BadRequestException('termId is required.');
    if (slots.length > 500) throw new BadRequestException('A timetable draft cannot contain more than 500 slots.');

    const assignmentIds = [...new Set(slots.map((slot) => slot.assignmentId))];
    const assignments = await this.prisma.teacherAssignment.findMany({
      where: { id: { in: assignmentIds } },
      select: {
        id: true,
        termId: true,
        staffId: true,
        classId: true,
        class: { select: { name: true } },
        subject: { select: { code: true, name: true } },
      },
    });

    const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
    const conflicts: TimetableConflict[] = [];
    const seenAssignments = new Set<string>();

    for (const slot of slots) {
      const assignment = byId.get(slot.assignmentId);
      const start = toMinutes(slot.startsAt);
      const end = toMinutes(slot.endsAt);

      if (!assignment) {
        conflicts.push({ type: 'TERM_MISMATCH', assignmentIds: [slot.assignmentId], message: `Assignment ${slot.assignmentId} was not found.` });
        continue;
      }
      if (assignment.termId !== termId) {
        conflicts.push({ type: 'TERM_MISMATCH', assignmentIds: [assignment.id], message: `Assignment ${assignment.id} belongs to a different term.` });
      }
      if (!Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 1 || slot.dayOfWeek > 7) {
        conflicts.push({ type: 'INVALID_DAY', assignmentIds: [assignment.id], message: `Assignment ${assignment.id} has an invalid dayOfWeek.` });
      }
      if (start < 0 || end < 0 || start >= end) {
        conflicts.push({ type: 'INVALID_TIME', assignmentIds: [assignment.id], message: `Assignment ${assignment.id} has an invalid time window.` });
      }
      if (!slot.room?.trim()) {
        conflicts.push({ type: 'ROOM_REQUIRED', assignmentIds: [assignment.id], message: `Assignment ${assignment.id} requires a room before publication.` });
      }
      if (seenAssignments.has(assignment.id)) {
        conflicts.push({ type: 'DUPLICATE_ASSIGNMENT', assignmentIds: [assignment.id], message: `Assignment ${assignment.id} appears more than once in the draft.` });
      }
      seenAssignments.add(assignment.id);
    }

    for (let index = 0; index < slots.length; index += 1) {
      const left = slots[index];
      const leftAssignment = byId.get(left.assignmentId);
      if (!leftAssignment) continue;

      for (let inner = index + 1; inner < slots.length; inner += 1) {
        const right = slots[inner];
        const rightAssignment = byId.get(right.assignmentId);
        if (!rightAssignment || !overlaps(left, right)) continue;

        if (leftAssignment.staffId === rightAssignment.staffId) {
          conflicts.push({ type: 'TEACHER_CONFLICT', assignmentIds: [leftAssignment.id, rightAssignment.id], message: `Teacher assignments ${leftAssignment.id} and ${rightAssignment.id} overlap.` });
        }
        if (leftAssignment.classId === rightAssignment.classId) {
          conflicts.push({ type: 'CLASS_CONFLICT', assignmentIds: [leftAssignment.id, rightAssignment.id], message: `Class ${leftAssignment.class.name} has overlapping periods.` });
        }
        const leftRoom = left.room?.trim();
        const rightRoom = right.room?.trim();
        if (leftRoom && rightRoom && leftRoom.toLowerCase() === rightRoom.toLowerCase()) {
          conflicts.push({ type: 'ROOM_CONFLICT', assignmentIds: [leftAssignment.id, rightAssignment.id], message: `Room ${leftRoom} is double-booked.` });
        }
      }
    }

    return { valid: conflicts.length === 0, slotCount: slots.length, conflicts };
  }
}
