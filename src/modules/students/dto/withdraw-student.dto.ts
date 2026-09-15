import { IsString, MaxLength, MinLength } from 'class-validator';

export class WithdrawStudentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
