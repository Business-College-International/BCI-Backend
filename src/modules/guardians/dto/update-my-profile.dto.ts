import { IsEmail, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class UpdateMyProfileDto {
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

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
  @Matches(/^\+?[0-9 ()-]{7,25}$/)
  phone?: string;

  @IsOptional()
  preferredSms?: boolean;

  @IsOptional()
  preferredPush?: boolean;
}
