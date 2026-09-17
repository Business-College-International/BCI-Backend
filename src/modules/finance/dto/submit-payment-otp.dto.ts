import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class SubmitPaymentOtpDto {
  @IsString()
  @IsNotEmpty()
  @Length(4, 12)
  otpCode!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  sessionId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  network?: string;
}
