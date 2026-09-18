import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { PayrollManagementController } from './payroll-management.controller';
import { PayrollCalculatorService } from './payroll-calculator.service';
import { PayrollReadinessController } from './payroll-readiness.controller';
import { PayrollReadinessService } from './payroll-readiness.service';
import { PayrollDisbursementController } from './payroll-disbursement.controller';
import { PayrollDisbursementService } from './payroll-disbursement.service';
import { PaymentProvidersModule } from '../payment-providers/payment-providers.module';

@Module({
  imports: [PaymentProvidersModule],
  controllers: [PayrollController, PayrollManagementController, PayrollReadinessController, PayrollDisbursementController],
  providers: [PayrollService, PayrollCalculatorService, PayrollReadinessService, PayrollDisbursementService],
})
export class PayrollModule {}
