import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceExpenseController } from './finance-expense.controller';
import { FinanceExpenseService } from './finance-expense.service';

@Module({
  imports: [AuthModule],
  controllers: [FinanceController, FinanceExpenseController],
  providers: [FinanceService, FinanceExpenseService, PrismaService],
})
export class FinanceModule {}
