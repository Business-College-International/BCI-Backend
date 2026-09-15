import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Level, Programme } from '@prisma/client';

export class CreateSubjectDto {
  @IsString()
  @MaxLength(50)
  code!: string;

  @IsString()
  @MaxLength(150)
  name!: string;

  @IsEnum(Level)
  level!: Level;

  @IsOptional()
  @IsBoolean()
  isElective?: boolean;

  @IsEnum(Programme)
  programme!: Programme;
}
