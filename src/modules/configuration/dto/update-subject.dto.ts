import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Level, Programme } from '@prisma/client';

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsEnum(Level)
  level?: Level;

  @IsOptional()
  @IsBoolean()
  isElective?: boolean;

  @IsOptional()
  @IsEnum(Programme)
  programme?: Programme;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
