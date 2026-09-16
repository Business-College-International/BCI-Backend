import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export type SubstitutionCandidateInput = {
  termId: string;
  originalStaffId: string;
  substituteStaffId: string;
  classId: string;
  subjectId: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
};

export type SubstitutionValidationResult = {
  valid: boolean;
  reasons: string[];
};

@Injectable()
export class SubstitutionValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(input: SubstitutionCandidateInput): Promise<SubstitutionValidationResult> {
    const reasons: string[] = [];
    if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 1 || input.dayOfWeek > 7) reasons.push('DAY_OF_WEEK_INVALID');
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) reasons.push('TIME_RANGE_INVALID');
    if (input.originalStaffId === input.substituteStaffId) reasons.push('SUBSTITUTE_SAME_AS_ORIGINAL');

    const [assignment, substitute, original] = await Promise.all([
      this.prisma.teacherAssignment.findFirst({ where: { staffId: input.originalStaffId, classId: input.classId, subjectId: input.subjectId, termId: input.termId } }),
      this.prisma.staff.findUnique({ where: { personId: input.substituteStaffId }, select: { personId: true, employmentStatus: true } }),
      this.prisma.staff.findUnique({ where: { personId: input.originalStaffId }, select: { personId: true, employmentStatus: true } }),
    ]);

    if (!assignment) reasons.push('ORIGINAL_ASSIGNMENT_NOT_FOUND');
    if (!substitute) reasons.push('SUBSTITUTE_STAFF_NOT_FOUND');
    if (!original) reasons.push('ORIGINAL_STAFF_NOT_FOUND');
    if (original && original.employmentStatus !== 'active') reasons.push('ORIGINAL_STAFF_NOT_ACTIVE');
    if (substitute && substitute.employmentStatus !== 'active') reasons.push('SUBSTITUTE_NOT_ACTIVE');

    if (substitute) {
      const existingAssignments = await this.prisma.teacherAssignment.findMany({ where: { staffId: substitute.personId, termId: input.termId }, select: { id: true, classId: true, subjectId: true } });
      if (existingAssignments.length === 0) reasons.push('SUBSTITUTE_HAS_NO_TERM_ASSIGNMENT');
    }

    return { valid: reasons.length === 0, reasons };
  }
}
