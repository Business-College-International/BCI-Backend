import { ConflictException, ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ExpenseStatus, Prisma, RoleName } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';

const ENTRY_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT]);
const APPROVER_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.ACCOUNTANT]);

@Injectable()
export class FinanceExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateExpenseDto, actorUserId: string, roles: RoleName[], idempotencyKey: string) {
    this.requireRole(roles, ENTRY_ROLES);
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey) throw new ConflictException('An Idempotency-Key header is required for expense creation.');

    const normalizedRequest = {
      category: dto.category.trim(),
      amount: new Prisma.Decimal(dto.amount).toFixed(2),
      description: dto.description?.trim() || null,
      receiptUrl: dto.receiptUrl?.trim() || null,
    };
    const requestHash = createHash('sha256').update(JSON.stringify(normalizedRequest)).digest('hex');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const keyRecord = await tx.idempotencyKey.upsert({
          where: {
            userId_key_operation: {
              userId: actorUserId,
              key: normalizedKey,
              operation: 'finance.expense.create',
            },
          },
          create: {
            userId: actorUserId,
            key: normalizedKey,
            operation: 'finance.expense.create',
            requestHash,
          },
          update: {},
        });

        if (keyRecord.requestHash !== requestHash) {
          throw new ConflictException('The expense Idempotency-Key was already used with different parameters.');
        }
        if (keyRecord.responseJson) {
          return keyRecord.responseJson as Prisma.JsonObject;
        }
        if (keyRecord.statusCode) {
          throw new ConflictException('An identical expense submission is already in progress.');
        }

        const expense = await tx.expense.create({
          data: {
            category: normalizedRequest.category,
            amount: new Prisma.Decimal(normalizedRequest.amount),
            description: normalizedRequest.description ?? undefined,
            receiptUrl: normalizedRequest.receiptUrl ?? undefined,
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

        const response = JSON.parse(JSON.stringify(this.view(expense)));
        await tx.idempotencyKey.update({
          where: {
            userId_key_operation: {
              userId: actorUserId,
              key: normalizedKey,
              operation: 'finance.expense.create',
            },
          },
          data: {
            responseJson: response,
            statusCode: 201,
            completedAt: new Date(),
          },
        });

        return response;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Expense creation conflicted with another financial operation. Please retry.');
      }
      throw error;
    }
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
