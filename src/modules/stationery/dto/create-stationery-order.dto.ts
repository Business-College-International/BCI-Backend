import { ArrayMinSize, IsArray, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class StationeryOrderLineDto {
  @IsUUID()
  itemId!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;
}

export class CreateStationeryOrderDto {
  @IsUUID()
  studentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StationeryOrderLineDto)
  lines!: StationeryOrderLineDto[];
}
