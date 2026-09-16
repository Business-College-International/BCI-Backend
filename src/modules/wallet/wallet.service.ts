import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleName, WalletTransactionType } from '@prisma/client';
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
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
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

    const hasUnsupportedReversal = await this.prisma.walletTransaction.count({
      where: { walletId: studentId, type: WalletTransactionType.REVERSAL },
    });
    if (hasUnsupportedReversal > 0) {
      return {
        student,
        exists: true,
        currency: wallet.currency,
        balance: null,
        balanceStatus: 'LEDGER_POLICY_REQUIRED',
        transactions: wallet.transactions.map((transaction) => ({
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount.toString(),
          providerReference: transaction.providerReference,
          processedBy: transaction.processedBy,
          createdAt: transaction.createdAt,
          note: transaction.note,
        })),
      };
    }

    const balance = wallet.transactions.reduce((running, transaction) => {
      if (transaction.type === WalletTransactionType.TOP_UP) return running.plus(transaction.amount);
      if (transaction.type === WalletTransactionType.WITHDRAWAL) return running.minus(transaction.amount);
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
      transactions: wallet.transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        amount: transaction.amount.toString(),
        providerReference: transaction.providerReference,
        processedBy: transaction.processedBy,
        createdAt: transaction.createdAt,
        note: transaction.note,
      })),
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
