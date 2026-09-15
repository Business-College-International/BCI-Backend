import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { AssessmentType } from '@prisma/client';

export class CreateAssessmentDto {
  @IsUUID()
  termId!: string;

  @IsUUID()
  subjectId!: string;

  @IsString()
  @Length(2, 120)
  title!: string;

  @IsEnum(AssessmentType)
  type!: AssessmentType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  maxScore!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  weight?: number;
}
