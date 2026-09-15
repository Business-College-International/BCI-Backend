import { IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreatePaymentIntentDto {
  @IsUUID()
  invoiceId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  clientReference?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;
}
