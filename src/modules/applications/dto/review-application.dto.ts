import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApplicationStatus } from '@prisma/client';

export class ReviewApplicationDto {
  @IsIn(['UNDER_REVIEW', 'REJECTED'])
  status!: Extract<ApplicationStatus, 'UNDER_REVIEW' | 'REJECTED'>;

  @IsOptional()
  @IsString()
  @Length(2, 500)
  reason?: string;
}
