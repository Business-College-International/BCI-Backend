import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { Level, Programme } from '@prisma/client';

export class CreateFeeScheduleDto {
  @IsUUID()
  termId!: string;

  @IsEnum(Level)
  level!: Level;

  @IsEnum(Programme)
  programme!: Programme;

  @IsString()
  @MaxLength(60)
  itemCode!: string;

  @IsString()
  @MaxLength(160)
  itemName!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}
