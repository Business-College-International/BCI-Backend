import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { Level, Programme } from '@prisma/client';

export class CreateFeeScheduleDto {
  @IsUUID()
  termId!: string;

  @IsEnum(Level)
  level!: Level;

  @IsEnum(Programme)
  programme!: Programme;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  itemCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  itemName!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}
