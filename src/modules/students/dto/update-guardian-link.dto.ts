import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateGuardianLinkDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  relationship?: string;

  @IsOptional()
  @IsBoolean()
  isPrimaryContact?: boolean;

  @IsOptional()
  @IsBoolean()
  canViewAcademic?: boolean;

  @IsOptional()
  @IsBoolean()
  canPayFees?: boolean;

  @IsOptional()
  @IsBoolean()
  canManageWallet?: boolean;
}
