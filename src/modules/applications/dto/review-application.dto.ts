import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ApplicationStatus } from '@prisma/client';

export class ReviewApplicationDto {
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus.UNDER_REVIEW | ApplicationStatus.REJECTED;

  @IsOptional()
  @IsString()
  @Length(2, 500)
  reason?: string;
}
