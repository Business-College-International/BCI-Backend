import { Controller, Get, Module } from '@nestjs/common';
import { AcademicReportsModule } from './modules/academic-reports/academic-reports.module';
import { AcademicsModule } from './modules/academics/academics.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AttendanceAnalyticsModule } from './modules/attendance/attendance-analytics.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { ConfigurationModule } from './modules/configuration/configuration.module';
import { FinanceModule } from './modules/finance/finance.module';
import { GuardiansModule } from './modules/guardians/guardians.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentProvidersModule } from './modules/payment-providers/payment-providers.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { StaffModule } from './modules/staff/staff.module';
import { StationeryModule } from './modules/stationery/stationery.module';
import { StudentRecordsModule } from './modules/student-records/student-records.module';
import { StudentsModule } from './modules/students/students.module';
import { TimetableModule } from './modules/timetable/timetable.module';
import { WalletModule } from './modules/wallet/wallet.module';

@Controller('health')
class HealthController {
  @Get()
  health(): { status: 'ok'; service: string; version: string } {
    return { status: 'ok', service: 'bci-backend-api', version: '0.1.0' };
  }
}

@Module({
  imports: [
    AuthModule,
    AuditModule,
    AcademicReportsModule,
    AcademicsModule,
    AnnouncementsModule,
    ApplicationsModule,
    AttendanceModule,
    AttendanceAnalyticsModule,
    AssessmentsModule,
    ConfigurationModule,
    GuardiansModule,
    NotificationsModule,
    PaymentProvidersModule,
    PayrollModule,
    StaffModule,
    StationeryModule,
    StudentRecordsModule,
    StudentsModule,
    TimetableModule,
    FinanceModule,
    WalletModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
