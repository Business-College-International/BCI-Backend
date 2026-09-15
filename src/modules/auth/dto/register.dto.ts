import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @Length(1, 100)
  lastName!: string;

  @IsString()
  @Length(7, 30)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}
