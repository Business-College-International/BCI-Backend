import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class WithdrawWalletDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsOptional()
  note?: string;
}
