import { IsOptional, IsUUID } from 'class-validator';

export class ListStudentAttendanceDto {
  @IsOptional()
  @IsUUID()
  termId?: string;
}
