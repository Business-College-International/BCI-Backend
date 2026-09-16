import { Module } from '@nestjs/common';
import { AcademicReportsController } from './academic-reports.controller';
import { ReportReadinessController } from './report-readiness.controller';
import { AcademicReportsService } from './academic-reports.service';
import { ReportReadinessService } from './report-readiness.service';

@Module({
  controllers: [AcademicReportsController, ReportReadinessController],
  providers: [AcademicReportsService, ReportReadinessService],
})
export class AcademicReportsModule {}
