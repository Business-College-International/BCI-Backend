import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PaymentPurpose, Prisma } from '@prisma/client';
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

  async recordBalancedEntry(
    lines: JournalLineInput[],
    actorUserId?: string,
    transactionClient?: Prisma.TransactionClient,
  ) {
    if (lines.length < 2) throw new BadRequestException('A journal transaction requires at least two lines.');

    const parsed = lines.map((line) => ({
      ...line,
      amount: new Prisma.Decimal(line.amount),
      currency: (line.currency ?? 'GHS').trim().toUpperCase(),
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

    const currency = parsed[0].currency;
    if (parsed.some((line) => line.currency !== currency)) {
      throw new BadRequestException('All journal lines must use the same currency.');
    }

    const referenceType = parsed[0].referenceType.trim();
    const referenceId = parsed[0].referenceId;
    if (parsed.some((line) => line.referenceType.trim() !== referenceType || line.referenceId !== referenceId)) {
      throw new BadRequestException('All journal lines must share the same transaction reference.');
    }

    const write = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${referenceType + ':' + referenceId}))`;

      const existing = await tx.financialJournalEntry.findMany({
        where: { referenceType, referenceId },
        orderBy: { transactionAt: 'asc' },
      });
      if (existing.length > 0) {
        const expected = parsed
          .map((line) => ({
            accountCode: line.accountCode.trim(),
            direction: line.direction,
            amount: line.amount.toFixed(2),
            currency: line.currency,
          }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const actual = existing
          .map((line) => ({
            accountCode: line.accountCode,
            direction: line.direction,
            amount: line.amount.toFixed(2),
            currency: line.currency,
          }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new ConflictException('An existing journal transaction uses the same reference with different accounting lines.');
        }
        return existing;
      }

      const entryNumber = `JNL-${new Date().getUTCFullYear()}-${randomBytes(6).toString('hex').toUpperCase()}`;
      return Promise.all(
        parsed.map((line) => tx.financialJournalEntry.create({
          data: {
            entryNumber,
            accountCode: line.accountCode.trim(),
            direction: line.direction,
            amount: line.amount,
            currency: line.currency,
            referenceType,
            referenceId,
            description: line.description?.trim(),
            createdBy: actorUserId,
          },
        })),
      );
    };

    if (transactionClient) return write(transactionClient);

    try {
      return await this.prisma.$transaction(write, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Journal transaction changed concurrently. Please retry.');
      }
      throw error;
    }
  }
  async recordPaymentSettlement(
    payment: { id: string; purpose: PaymentPurpose; amount: Prisma.Decimal; currency: string },
    actorUserId: string | undefined,
    transactionClient: Prisma.TransactionClient,
  ) {
    const revenueAccount = paymentRevenueAccount(payment.purpose);
    return this.recordBalancedEntry([
      { accountCode: 'CASH', direction: 'DEBIT', amount: payment.amount.toFixed(2), currency: payment.currency, referenceType: 'Payment', referenceId: payment.id, description: `Payment ${payment.id} settlement` },
      { accountCode: revenueAccount, direction: 'CREDIT', amount: payment.amount.toFixed(2), currency: payment.currency, referenceType: 'Payment', referenceId: payment.id, description: `Payment ${payment.id} settlement` },
    ], actorUserId, transactionClient);
  }
}

function paymentRevenueAccount(purpose: PaymentPurpose) {
  switch (purpose) {
    case PaymentPurpose.FEE: return 'FEES';
    case PaymentPurpose.WALLET_TOP_UP: return 'WALLET_LIABILITY';
    case PaymentPurpose.STATIONERY: return 'STATIONERY_REVENUE';
    default: throw new BadRequestException(`No accounting mapping exists for payment purpose ${purpose}.`);
  }
}
