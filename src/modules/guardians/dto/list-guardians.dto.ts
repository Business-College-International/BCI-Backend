import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListGuardiansDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
