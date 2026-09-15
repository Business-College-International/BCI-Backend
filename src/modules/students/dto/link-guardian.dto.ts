import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LinkGuardianDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  guardianId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  relationship!: string;

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
