import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleName, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { WithdrawWalletDto } from './dto/withdraw-wallet.dto';

@Injectable()
export class WalletOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async withdraw(studentId: string, dto: WithdrawWalletDto, actorUserId: string, roles: RoleName[]) {
    if (!roles.includes(RoleName.DIRECTOR) && !roles.includes(RoleName.OFFICE) && !roles.includes(RoleName.ACCOUNTANT)) {
      throw new ForbiddenException('Only authorized finance/office staff may process a wallet withdrawal.');
    }

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lte(0)) throw new BadRequestException('Withdrawal amount must be greater than zero.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { studentId },
          include: {
            transactions: {
              orderBy: { createdAt: 'asc' },
              select: { id: true, type: true, amount: true },
            },
          },
        });
        if (!wallet) throw new NotFoundException('Student wallet does not exist.');

        const hasUnsupportedReversal = wallet.transactions.some((transaction) => transaction.type === WalletTransactionType.REVERSAL);
        if (hasUnsupportedReversal) {
          throw new ConflictException('Wallet contains reversal transactions that require ledger reconciliation before withdrawal.');
        }

        const balance = wallet.transactions.reduce((running, transaction) => {
          if (transaction.type === WalletTransactionType.TOP_UP) return running.plus(transaction.amount);
          if (transaction.type === WalletTransactionType.WITHDRAWAL) return running.minus(transaction.amount);
          return running;
        }, new Prisma.Decimal(0));

        if (amount.gt(balance)) {
          throw new ConflictException(`Insufficient wallet balance. Available balance: ${balance.toFixed(2)}.`);
        }

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: studentId,
            type: WalletTransactionType.WITHDRAWAL,
            amount,
            processedBy: actorUserId,
            note: dto.note?.trim() || 'Office wallet withdrawal',
          },
        });

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

        return {
          transactionId: transaction.id,
          studentId,
          amount: transaction.amount.toString(),
          currency: wallet.currency,
          balance: balance.minus(amount).toFixed(2),
          status: 'COMPLETED',
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Wallet changed concurrently. Please retry the withdrawal.');
      }
      throw error;
    }
  }
}
