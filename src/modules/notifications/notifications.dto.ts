import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListNotificationsDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;
}
