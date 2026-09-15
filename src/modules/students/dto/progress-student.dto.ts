import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { Level, Programme } from '@prisma/client';

export class ProgressStudentDto {
  @IsUUID()
  targetTermId!: string;

  @IsUUID()
  targetClassId!: string;

  @IsEnum(Level)
  targetLevel!: Level;

  @IsEnum(Programme)
  targetProgramme!: Programme;

  @IsOptional()
  @IsString()
  reason?: string;
}
