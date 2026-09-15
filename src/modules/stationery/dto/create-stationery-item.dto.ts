import { IsBoolean, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateStationeryItemDto {
  @IsString()
  @Length(2, 40)
  sku!: string;

  @IsString()
  @Length(2, 160)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  price!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
