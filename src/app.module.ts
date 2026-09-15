import { Controller, Get, Module } from '@nestjs/common';
import { AcademicReportsModule } from './modules/academic-reports/academic-reports.module';
import { AcademicsModule } from './modules/academics/academics.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { AuthModule } from './modules/auth/auth.module';
import { FinanceModule } from './modules/finance/finance.module';
import { GuardiansModule } from './modules/guardians/guardians.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { StaffModule } from './modules/staff/staff.module';
import { StationeryModule } from './modules/stationery/stationery.module';
import { StudentsModule } from './modules/students/students.module';
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
    AcademicReportsModule,
    AcademicsModule,
    AnnouncementsModule,
    ApplicationsModule,
    AttendanceModule,
    AssessmentsModule,
    GuardiansModule,
    PayrollModule,
    StaffModule,
    StationeryModule,
    StudentsModule,
    FinanceModule,
    WalletModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
