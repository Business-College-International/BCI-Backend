import { IsString, MinLength } from 'class-validator';

export class TransferStudentDto {
  @IsString()
  @MinLength(3)
  reason!: string;

  @IsString()
  @MinLength(2)
  destinationSchool!: string;
}
