import { IsUUID } from 'class-validator';

export class ListFeeSchedulesDto {
  @IsUUID()
  termId!: string;
}
