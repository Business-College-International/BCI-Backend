import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FinancialJournalService } from './financial-journal.service';

@Module({
  providers: [PrismaService, FinancialJournalService],
  exports: [FinancialJournalService],
})
export class AccountingModule {}
