import { IsUUID } from 'class-validator';

export class AttachStationeryPaymentDto {
  @IsUUID()
  paymentId!: string;
}
