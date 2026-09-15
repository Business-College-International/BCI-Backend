import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  division?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  room?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}
