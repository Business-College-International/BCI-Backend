import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class FinanceSummaryDto {
  @IsString()
  @IsOptional()
  termId?: string;

  @IsISO8601()
  @IsOptional()
  from?: string;

  @IsISO8601()
  @IsOptional()
  to?: string;
}
