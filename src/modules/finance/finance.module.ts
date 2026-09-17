import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
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
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { FinanceIntegrityController } from './finance-integrity.controller';
import { FinanceIntegrityService } from './finance-integrity.service';
import { RefundController } from './refund.controller';
import { RefundService } from './refund.service';
import { FinancialJournalService } from './financial-journal.service';
import { FinanceStatementController } from './finance-statement.controller';
import { FinanceStatementService } from './finance-statement.service';
import { FinanceBillingRunController } from './finance-billing-run.controller';
import { FinanceBillingRunService } from './finance-billing-run.service';

@Module({
  imports: [AuthModule, PaymentProvidersModule],
  controllers: [
    FinanceController,
    FinanceExpenseController,
    FinanceReceivablesController,
    PaymentPreflightController,
    PaymentController,
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
    PaymentService,
    FinanceIntegrityService,
    RefundService,
    FinancialJournalService,
    FinanceStatementService,
    FinanceBillingRunService,
    PrismaService,
  ],
  exports: [RefundService, FinancialJournalService, PaymentService],
})
export class FinanceModule {}
