import { IsString, Length } from 'class-validator';

export class RefreshDto {
  @IsString()
  @Length(20, 512)
  refreshToken!: string;
}
