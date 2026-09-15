import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { Level, Programme } from '@prisma/client';

export class CreateClassDto {
  @IsUUID()
  academicYearId!: string;

  @IsString()
  @Length(2, 80)
  name!: string;

  @IsEnum(Level)
  level!: Level;

  @IsEnum(Programme)
  programme!: Programme;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  division?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  room?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}
