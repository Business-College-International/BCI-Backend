import { IsUUID } from 'class-validator';

export class CreateTeacherAssignmentDto {
  @IsUUID()
  classId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  termId!: string;
}
