import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { InvoiceStatus } from '@prisma/client';

export class ListInvoicesDto {
  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  q?: string;
}
