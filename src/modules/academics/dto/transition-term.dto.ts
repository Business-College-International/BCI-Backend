import { IsEnum } from 'class-validator';
import { TermStatus } from '@prisma/client';

export class TransitionTermDto {
  @IsEnum(TermStatus)
  status!: TermStatus;
}
