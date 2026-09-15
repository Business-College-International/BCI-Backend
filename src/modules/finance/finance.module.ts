import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceExpenseController } from './finance-expense.controller';
import { FinanceExpenseService } from './finance-expense.service';
import { FinanceReceivablesController } from './finance-receivables.controller';
import { FinanceReceivablesService } from './finance-receivables.service';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController, FinanceExpenseController, FinanceReceivablesController],
  providers: [FinanceService, FinanceExpenseService, FinanceReceivablesService, PrismaService],
})
export class FinanceModule {}
