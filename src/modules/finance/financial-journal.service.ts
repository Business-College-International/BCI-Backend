import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { randomBytes } from 'node:crypto';

type JournalLineInput = {
  accountCode: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  currency?: string;
  referenceType: string;
  referenceId: string;
  description?: string;
};

@Injectable()
export class FinancialJournalService {
  constructor(private readonly prisma: PrismaService) {}

  async recordBalancedEntry(lines: JournalLineInput[], actorUserId?: string) {
    if (lines.length < 2) throw new BadRequestException('A journal transaction requires at least two lines.');

    const parsed = lines.map((line) => ({
      ...line,
      amount: new Prisma.Decimal(line.amount),
      currency: line.currency ?? 'GHS',
    }));

    if (parsed.some((line) => line.amount.lte(0))) {
      throw new BadRequestException('Journal amounts must be greater than zero.');
    }

    const debit = parsed
      .filter((line) => line.direction === 'DEBIT')
      .reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));
    const credit = parsed
      .filter((line) => line.direction === 'CREDIT')
      .reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0));

    if (!debit.eq(credit)) {
      throw new BadRequestException('Journal transaction is not balanced.');
    }

    const entryNumber = `JNL-${new Date().getUTCFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`;
    return this.prisma.$transaction(async (tx) => Promise.all(
      parsed.map((line) => tx.financialJournalEntry.create({
        data: {
          entryNumber,
          accountCode: line.accountCode.trim(),
          direction: line.direction,
          amount: line.amount,
          currency: line.currency,
          referenceType: line.referenceType.trim(),
          referenceId: line.referenceId,
          description: line.description?.trim(),
          createdBy: actorUserId,
        },
      })),
    ));
  }
}
