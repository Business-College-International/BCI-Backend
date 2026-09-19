import { Module } from '@nestjs/common';
import { AcademicReportsController } from './academic-reports.controller';
import { ReportReadinessController } from './report-readiness.controller';
import { AcademicReportsService } from './academic-reports.service';
import { ReportReadinessService } from './report-readiness.service';
import { GradingPolicyController } from './grading-policy.controller';
import { GradingPolicyService } from './grading-policy.service';
import { ReportCardPublicationController } from './report-card-publication.controller';
import { ReportCardPublicationService } from './report-card-publication.service';

@Module({
  controllers: [AcademicReportsController, ReportReadinessController, GradingPolicyController, ReportCardPublicationController],
  providers: [AcademicReportsService, ReportReadinessService, GradingPolicyService, ReportCardPublicationService],
})
export class AcademicReportsModule {}