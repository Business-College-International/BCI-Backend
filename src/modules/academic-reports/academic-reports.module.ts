import { Module } from '@nestjs/common';
import { AcademicReportsController } from './academic-reports.controller';
import { AcademicReportsService } from './academic-reports.service';

@Module({
  controllers: [AcademicReportsController],
  providers: [AcademicReportsService],
})
export class AcademicReportsModule {}
