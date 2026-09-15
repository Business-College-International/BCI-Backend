import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export class StudentDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  type!: string;

  @IsUrl({ require_tld: false })
  fileUrl!: string;
}
