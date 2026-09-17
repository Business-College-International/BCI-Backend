import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class InitiatePaymentDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  invoiceIds!: string[];

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  amount!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @IsIn(['MTN', 'TELECEL', 'VODAFONE', 'AIRTELTIGO'])
  network?: string;

  @IsString()
  callbackUrl!: string;
}
