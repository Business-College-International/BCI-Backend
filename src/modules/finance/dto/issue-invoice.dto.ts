import { IsArray, IsDateString, IsOptional, IsString, IsUUID, ArrayMinSize, MaxLength } from 'class-validator';

export class IssueInvoiceDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  termId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  feeScheduleIds!: string[];

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
