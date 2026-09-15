import { IsUUID } from 'class-validator';

export class AssignElectiveDto {
  @IsUUID()
  termId!: string;

  @IsUUID()
  subjectId!: string;
}
