import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleName, WalletTransactionDirection, WalletTransactionType } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { WithdrawWalletDto } from './dto/withdraw-wallet.dto';

@Injectable()
export class WalletOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async withdraw(
    studentId: string,
    dto: WithdrawWalletDto,
    actorUserId: string,
    roles: RoleName[],
    idempotencyKey: string,
  ) {
    if (!roles.includes(RoleName.DIRECTOR) && !roles.includes(RoleName.OFFICE) && !roles.includes(RoleName.ACCOUNTANT)) {
      throw new ForbiddenException('Only authorized finance/office staff may process a wallet withdrawal.');
    }
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey) throw new ConflictException('An Idempotency-Key header is required for wallet withdrawals.');

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Withdrawal amount must be greater than zero.');

    const requestHash = createHash('sha256')
      .update(JSON.stringify({
        studentId,
        amount: dto.amount,
        note: dto.note?.trim() || null,
      }))
      .digest('hex');

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existingKey = await tx.idempotencyKey.findUnique({
          where: {
            userId_key_operation: {
              userId: actorUserId,
              key: normalizedKey,
              operation: 'wallet.withdrawal',
            },
          },
        });
        if (existingKey) {
          if (existingKey.requestHash !== requestHash) {
            throw new ConflictException('The wallet withdrawal Idempotency-Key was already used with different parameters.');
          }
          if (existingKey.responseJson) return { existing: existingKey.responseJson as Record<string, unknown> };
          throw new ConflictException('An identical wallet withdrawal is already in progress.');
        }

        await tx.idempotencyKey.create({
          data: {
            userId: actorUserId,
            key: normalizedKey,
            operation: 'wallet.withdrawal',
            requestHash,
          },
        });

        await tx.$queryRaw`SELECT "studentId" FROM "Wallet" WHERE "studentId" = ${studentId} FOR UPDATE`;

        const wallet = await tx.wallet.findUnique({
          where: { studentId },
          include: {
            transactions: {
              orderBy: { createdAt: 'asc' },
              select: { id: true, type: true, direction: true, amount: true, reversalOfId: true, paymentId: true },
            },
          },
        });
        if (!wallet) throw new NotFoundException('Student wallet does not exist.');

        const unresolvedLedgerEntry = wallet.transactions.find((transaction) =>
          transaction.direction === null ||
          (transaction.type === WalletTransactionType.REVERSAL && !transaction.reversalOfId),
        );
        if (unresolvedLedgerEntry) {
          throw new ConflictException('Wallet ledger contains transactions without complete signed effects. Reconciliation is required before withdrawal.');
        }

        const balance = wallet.transactions.reduce((running, transaction) => {
          if (transaction.direction === WalletTransactionDirection.CREDIT) return running.plus(transaction.amount);
          if (transaction.direction === WalletTransactionDirection.DEBIT) return running.minus(transaction.amount);
          return running;
        }, new Prisma.Decimal(0));

        if (amount.gt(balance)) {
          throw new ConflictException(`Insufficient wallet balance. Available balance: ${balance.toFixed(2)}.`);
        }

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: studentId,
            type: WalletTransactionType.WITHDRAWAL,
            direction: WalletTransactionDirection.DEBIT,
            amount,
            processedBy: actorUserId,
            note: dto.note?.trim() || 'Office wallet withdrawal',
          },
        });

        const response = {
          transactionId: transaction.id,
          studentId,
          amount: transaction.amount.toString(),
          currency: wallet.currency,
          balance: balance.minus(amount).toFixed(2),
          status: 'COMPLETED',
        };

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'RECONCILE',
            entityType: 'Wallet',
            entityId: studentId,
            beforeJson: { balance: balance.toFixed(2) },
            afterJson: { balance: balance.minus(amount).toFixed(2), transactionId: transaction.id, type: 'WITHDRAWAL' },
          },
        });

        await tx.idempotencyKey.update({
          where: {
            userId_key_operation: {
              userId: actorUserId,
              key: normalizedKey,
              operation: 'wallet.withdrawal',
            },
          },
          data: {
            responseJson: response,
            statusCode: 200,
            completedAt: new Date(),
          },
        });

        return { response };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });

      return 'existing' in result ? result.existing : result.response;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2034') {
        throw new ConflictException('Wallet changed concurrently. Please retry the withdrawal.');
      }
      if (code === 'P2002') {
        throw new ConflictException('A withdrawal with this Idempotency-Key is already being processed. Retry the same request.');
      }
      throw error;
    }
  }
}
