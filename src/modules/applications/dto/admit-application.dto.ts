import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class AdmitApplicationDto {
  @IsUUID()
  academicYearId!: string;

  @IsUUID()
  termId!: string;

  @IsUUID()
  classId!: string;

  @IsOptional()
  @IsString()
  @Length(3, 50)
  admissionNumber?: string;
}
