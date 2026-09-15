import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAttendanceSessionDto {
  @IsUUID()
  termId!: string;

  @IsUUID()
  classId!: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsDateString()
  sessionDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  periodLabel?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
