import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollManagementController } from './payroll-management.controller';
import { PayrollCalculatorService } from './payroll-calculator.service';

@Module({
  controllers: [PayrollController, PayrollManagementController],
  providers: [PayrollService, PayrollCalculatorService],
})
export class PayrollModule {}
