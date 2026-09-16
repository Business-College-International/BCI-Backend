import { IsBoolean, IsOptional, IsUUID, IsDateString } from 'class-validator';

export class BillingRunDto {
  @IsUUID()
  termId!: string;

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsBoolean()
  includeOptional?: boolean;
}
