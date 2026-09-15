import { IsOptional, IsUUID } from 'class-validator';

export class ListTeacherAssignmentsDto {
  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;
}
