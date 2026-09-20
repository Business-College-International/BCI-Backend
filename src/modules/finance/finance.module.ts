import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AccountingModule } from '../accounting/accounting.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentProvidersModule } from '../payment-providers/payment-providers.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceExpenseController } from './finance-expense.controller';
import { FinanceExpenseService } from './finance-expense.service';
import { FinanceReceivablesController } from './finance-receivables.controller';
import { FinanceReceivablesService } from './finance-receivables.service';
import { PaymentPreflightController } from './payment-preflight.controller';
import { PaymentPreflightService } from './payment-preflight.service';
import { PaymentInitiationController } from './payment-initiation.controller';
import { PaymentInitiationService } from './payment-initiation.service';
import { PaymentOtpController } from './payment-otp.controller';
import { PaymentOtpService } from './payment-otp.service';
import { FinanceIntegrityController } from './finance-integrity.controller';
import { FinanceIntegrityService } from './finance-integrity.service';
import { RefundController } from './refund.controller';
import { RefundService } from './refund.service';
import { FinanceStatementController } from './finance-statement.controller';
import { FinanceStatementService } from './finance-statement.service';
import { FinanceBillingRunController } from './finance-billing-run.controller';
import { FinanceBillingRunService } from './finance-billing-run.service';

@Module({
  imports: [AuthModule, PaymentProvidersModule, AccountingModule],
  controllers: [
    FinanceController,
    FinanceExpenseController,
    FinanceReceivablesController,
    PaymentPreflightController,
    PaymentInitiationController,
    PaymentOtpController,
    FinanceIntegrityController,
    RefundController,
    FinanceStatementController,
    FinanceBillingRunController,
  ],
  providers: [
    FinanceService,
    FinanceExpenseService,
    FinanceReceivablesService,
    PaymentPreflightService,
    PaymentInitiationService,
    PaymentOtpService,
    FinanceIntegrityService,
    RefundService,
    FinanceStatementService,
    FinanceBillingRunService,
    PrismaService,
  ],
  exports: [AccountingModule, RefundService, PaymentInitiationService, PaymentOtpService],
})
export class FinanceModule {}
