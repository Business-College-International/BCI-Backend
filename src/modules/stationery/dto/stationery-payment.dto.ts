import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StationeryPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  network?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  callbackUrl?: string;
}
