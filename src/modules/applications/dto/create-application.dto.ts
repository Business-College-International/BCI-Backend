import { IsDateString, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { Level, Programme } from '@prisma/client';

export class CreateApplicationDto {
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @IsDateString()
  dob!: string;

  @IsEnum(Level)
  levelApplied!: Level;

  @IsEnum(Programme)
  programmeApplied!: Programme;

  @IsString()
  @Length(2, 160)
  guardianName!: string;

  @IsString()
  @Length(7, 30)
  guardianPhone!: string;

  @IsOptional()
  @IsString()
  @Length(2, 200)
  previousSchool?: string;

  @IsOptional()
  @IsString()
  passportPhotoUrl?: string;
}
