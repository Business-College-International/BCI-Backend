import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ExpenseStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';

const ENTRY_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT]);
const APPROVER_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.ACCOUNTANT]);

@Injectable()
export class FinanceExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateExpenseDto, actorUserId: string, roles: RoleName[]) {
    this.requireRole(roles, ENTRY_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          category: dto.category.trim(),
          amount: new Prisma.Decimal(dto.amount),
          description: dto.description?.trim(),
          receiptUrl: dto.receiptUrl?.trim(),
          enteredBy: actorUserId,
          status: ExpenseStatus.DRAFT,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'Expense',
          entityId: expense.id,
          afterJson: { category: expense.category, amount: expense.amount.toString(), status: expense.status },
        },
      });
      return this.view(expense);
    });
  }

  async submit(id: string, actorUserId: string, roles: RoleName[]) {
    this.requireRole(roles, ENTRY_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findUnique({ where: { id } });
      if (!expense) throw new NotFoundException('Expense not found.');
      if (expense.enteredBy !== actorUserId) throw new ForbiddenException('Only the expense submitter can submit this expense.');
      if (expense.status !== ExpenseStatus.DRAFT) throw new BadRequestException('Only draft expenses can be submitted.');
      const updated = await tx.expense.update({ where: { id }, data: { status: ExpenseStatus.SUBMITTED } });
      await this.audit(tx, actorUserId, id, 'SUBMIT', expense.status, updated.status);
      return this.view(updated);
    });
  }

  async decide(id: string, decision: 'APPROVED' | 'REJECTED', actorUserId: string, roles: RoleName[]) {
    this.requireRole(roles, APPROVER_ROLES);
    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findUnique({ where: { id } });
      if (!expense) throw new NotFoundException('Expense not found.');
      if (expense.status !== ExpenseStatus.SUBMITTED) throw new BadRequestException('Only submitted expenses can be approved or rejected.');
      if (expense.enteredBy === actorUserId) throw new ForbiddenException('The submitter cannot approve or reject their own expense.');
      const updated = await tx.expense.update({
        where: { id },
        data: { status: decision === 'APPROVED' ? ExpenseStatus.APPROVED : ExpenseStatus.REJECTED, approvedBy: actorUserId, approvedAt: new Date() },
      });
      await this.audit(tx, actorUserId, id, decision, expense.status, updated.status);
      return this.view(updated);
    });
  }

  async list(status: ExpenseStatus | undefined, roles: RoleName[]) {
    this.requireRole(roles, ENTRY_ROLES);
    const expenses = await this.prisma.expense.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 250,
    });
    return expenses.map((expense) => this.view(expense));
  }

  private view(expense: { id: string; category: string; amount: Prisma.Decimal; currency: string; description: string | null; receiptUrl: string | null; enteredBy: string; approvedBy: string | null; status: ExpenseStatus; createdAt: Date; approvedAt: Date | null; paidAt: Date | null }) {
    return { ...expense, amount: expense.amount.toFixed(2) };
  }

  private requireRole(roles: RoleName[], allowed: Set<RoleName>) {
    if (!roles.some((role) => allowed.has(role))) throw new ForbiddenException('Expense access is restricted.');
  }

  private async audit(tx: Prisma.TransactionClient, actorUserId: string, entityId: string, action: string, beforeStatus: ExpenseStatus, afterStatus: ExpenseStatus) {
    await tx.auditLog.create({ data: { actorUserId, action: 'UPDATE', entityType: 'Expense', entityId, beforeJson: { status: beforeStatus }, afterJson: { status: afterStatus, decision: action } } });
  }
}
