import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollManagementController } from './payroll-management.controller';
import { PayrollCalculatorService } from './payroll-calculator.service';
import { PayrollReadinessController } from './payroll-readiness.controller';
import { PayrollReadinessService } from './payroll-readiness.service';

@Module({
  controllers: [PayrollController, PayrollManagementController, PayrollReadinessController],
  providers: [PayrollService, PayrollCalculatorService, PayrollReadinessService],
})
export class PayrollModule {}
