import { IsDateString, IsEnum, IsString, Length } from 'class-validator';
import { TermStatus } from '@prisma/client';

export class CreateTermDto {
  @IsString()
  @Length(2, 30)
  code!: string;

  @IsString()
  @Length(2, 100)
  name!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsEnum(TermStatus)
  status!: TermStatus;
}
