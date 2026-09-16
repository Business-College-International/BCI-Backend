import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class RequestRefundDto {
  @IsString()
  @IsNotEmpty()
  paymentId!: string;

  @Matches(/^\d+(\.\d{1,2})?$/)
  amount!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
