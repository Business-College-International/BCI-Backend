import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStaffRecordDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  contractType?: string;

  @IsOptional()
  @IsIn(['active', 'on_leave', 'suspended', 'terminated'])
  employmentStatus?: string;
}
