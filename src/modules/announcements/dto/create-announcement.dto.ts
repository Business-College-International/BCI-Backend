import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const ANNOUNCEMENT_AUDIENCES = ['ALL', 'GUARDIANS', 'STAFF', 'TEACHERS', 'USER'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(3)
  @MaxLength(180)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body!: string;

  @IsIn(ANNOUNCEMENT_AUDIENCES)
  audienceType!: AnnouncementAudience;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  audienceRef?: string;
}
