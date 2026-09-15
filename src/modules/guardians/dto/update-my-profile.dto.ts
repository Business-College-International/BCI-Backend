import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMyProfileDto {
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  hometown?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @IsOptional()
  preferredSms?: boolean;

  @IsOptional()
  preferredPush?: boolean;
}
