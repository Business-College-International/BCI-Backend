import { IsString, Length } from 'class-validator';

export class VoidInvoiceDto {
  @IsString()
  @Length(5, 500)
  reason!: string;
}
