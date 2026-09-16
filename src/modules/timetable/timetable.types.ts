export type TimetableSlotInput = {
  assignmentId: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  room?: string;
};

export type TimetableConflictType =
  | 'INVALID_DAY'
  | 'INVALID_TIME'
  | 'DUPLICATE_ASSIGNMENT'
  | 'TEACHER_CONFLICT'
  | 'CLASS_CONFLICT'
  | 'ROOM_CONFLICT'
  | 'TERM_MISMATCH'
  | 'ROOM_REQUIRED';

export type TimetableConflict = {
  type: TimetableConflictType;
  assignmentIds: string[];
  message: string;
};

export type TimetableValidationResult = {
  valid: boolean;
  slotCount: number;
  conflicts: TimetableConflict[];
};
