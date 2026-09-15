import { IsInt, IsString, Length, Max, Min } from 'class-validator';

export class AdjustStockDto {
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity!: number;

  @IsString()
  @Length(2, 80)
  movementType!: string;

  @IsString()
  @Length(0, 240)
  note!: string;
}
