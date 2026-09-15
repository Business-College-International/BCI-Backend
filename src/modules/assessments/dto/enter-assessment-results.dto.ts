import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AssessmentResultInputDto {
  @IsUUID()
  studentId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  score!: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class EnterAssessmentResultsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssessmentResultInputDto)
  results!: AssessmentResultInputDto[];
}
