import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStaffDutyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
