import { IsArray, ArrayMinSize, IsOptional, IsString, Matches } from 'class-validator';

export class InitiatePaymentDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  invoiceIds!: string[];

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a positive monetary value with up to 2 decimal places.',
  })
  amount?: string;

  @IsOptional()
  @IsString()
  network?: string;

  @IsOptional()
  @IsString()
  callbackUrl?: string;
}
