import { IsBoolean, IsDateString, IsOptional, IsString, Length } from 'class-validator';

export class CreateAcademicYearDto {
  @IsString()
  @Length(4, 30)
  name!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}
