import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceExpenseController } from './finance-expense.controller';
import { FinanceExpenseService } from './finance-expense.service';
import { FinanceReceivablesController } from './finance-receivables.controller';
import { FinanceReceivablesService } from './finance-receivables.service';
import { PaymentPreflightController } from './payment-preflight.controller';
import { PaymentPreflightService } from './payment-preflight.service';
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
  imports: [AuthModule],
  controllers: [
    FinanceController,
    FinanceExpenseController,
    FinanceReceivablesController,
    PaymentPreflightController,
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
    FinanceIntegrityService,
    RefundService,
    FinancialJournalService,
    FinanceStatementService,
    FinanceBillingRunService,
    PrismaService,
  ],
  exports: [RefundService, FinancialJournalService],
})
export class FinanceModule {}
