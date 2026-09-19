import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested } from 'class-validator';
import { Level, Programme } from '@prisma/client';

const PERCENT_PATTERN = /^\d{1,3}(?:\.\d{1,2})?$/;

export class GradingBandDto {
  @IsString()
  @Length(1, 20)
  code!: string;

  @IsString()
  @Matches(PERCENT_PATTERN)
  lowerInclusive!: string;

  @IsOptional()
  @IsString()
  @Matches(PERCENT_PATTERN)
  upperExclusive?: string;

  @IsBoolean()
  pass!: boolean;

  @IsString()
  @Length(1, 200)
  descriptor!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(?:\.\d{1,2})?$/)
  points?: string;

  @IsInt()
  @Min(1)
  order!: number;
}

export class CreateGradingPolicyDto {
  @IsUUID()
  academicYearId!: string;

  @IsString()
  @Length(1, 100)
  name!: string;

  @IsEnum(Level)
  level!: Level;

  @IsOptional()
  @IsEnum(Programme)
  programme?: Programme | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GradingBandDto)
  bands!: GradingBandDto[];
}

export class UpdateGradingPolicyDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GradingBandDto)
  bands?: GradingBandDto[];
}
