import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleName, WalletTransactionDirection, WalletTransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const PRIVILEGED_WALLET_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
  RoleName.ACCOUNTANT,
]);

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentWallet(studentId: string, actorUserId: string, roles: RoleName[]) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, admissionNumber: true, firstName: true, lastName: true, status: true },
    });
    if (!student) throw new NotFoundException('Student not found.');

    const scope = await this.resolveScope(studentId, actorUserId, roles);
    if (!scope.allowed) {
      throw new ForbiddenException('You do not have access to this student wallet.');
    }
    if (scope.isGuardian && !scope.canManageWallet) {
      throw new ForbiddenException('This guardian is not permitted to view this ward wallet.');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { studentId },
      select: { studentId: true, currency: true },
    });

    if (!wallet) {
      return {
        student,
        exists: false,
        currency: 'GHS',
        balance: null,
        balanceStatus: 'NO_WALLET',
        transactions: [],
      };
    }

    const [recentTransactions, ledgerTransactions] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletId: studentId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.walletTransaction.findMany({
        where: { walletId: studentId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          direction: true,
          amount: true,
          reversalOfId: true,
          paymentId: true,
        },
      }),
    ]);

    const transactions = recentTransactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      direction: transaction.direction,
      amount: transaction.amount.toString(),
      reversalOfId: transaction.reversalOfId,
      paymentId: transaction.paymentId,
      providerReference: transaction.providerReference,
      processedBy: transaction.processedBy,
      createdAt: transaction.createdAt,
      note: transaction.note,
    }));

    const unresolvedLedgerEntry = ledgerTransactions.find((transaction) =>
      transaction.direction === null ||
      (transaction.type === WalletTransactionType.REVERSAL && !transaction.reversalOfId),
    );
    if (unresolvedLedgerEntry) {
      return {
        student,
        exists: true,
        currency: wallet.currency,
        balance: null,
        balanceStatus: 'LEDGER_POLICY_REQUIRED',
        transactions,
      };
    }

    const balance = ledgerTransactions.reduce((running, transaction) => {
      if (transaction.direction === WalletTransactionDirection.CREDIT) {
        return running.plus(transaction.amount);
      }
      if (transaction.direction === WalletTransactionDirection.DEBIT) {
        return running.minus(transaction.amount);
      }
      return running;
    }, new Prisma.Decimal(0));

    if (balance.lt(0)) {
      throw new ConflictException('Wallet ledger has a negative balance and requires reconciliation.');
    }
    return {
      student,
      exists: true,
      currency: wallet.currency,
      balance: balance.toFixed(2),
      balanceStatus: 'CALCULATED',
      transactions,
    };
  }

  private async resolveScope(studentId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => PRIVILEGED_WALLET_ROLES.has(role))) {
      return { allowed: true, isGuardian: false, canManageWallet: true };
    }

    const guardian = await this.prisma.guardian.findUnique({
      where: { userId: actorUserId },
      select: { personId: true },
    });
    if (!guardian) return { allowed: false, isGuardian: false, canManageWallet: false };

    const link = await this.prisma.guardianStudent.findUnique({
      where: { guardianId_studentId: { guardianId: guardian.personId, studentId } },
      select: { canManageWallet: true },
    });
    if (!link) return { allowed: false, isGuardian: true, canManageWallet: false };

    return {
      allowed: true,
      isGuardian: true,
      canManageWallet: link.canManageWallet,
    };
  }
}
