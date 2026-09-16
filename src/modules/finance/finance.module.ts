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

@Module({
  imports: [AuthModule],
  controllers: [
    FinanceController,
    FinanceExpenseController,
    FinanceReceivablesController,
    PaymentPreflightController,
    FinanceIntegrityController,
  ],
  providers: [
    FinanceService,
    FinanceExpenseService,
    FinanceReceivablesService,
    PaymentPreflightService,
    FinanceIntegrityService,
    PrismaService,
  ],
})
export class FinanceModule {}
