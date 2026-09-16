import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoleName } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { BillingRunDto } from './dto/billing-run.dto';

const BILLING_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.ACCOUNTANT, RoleName.OFFICE]);

type BillingCandidate = {
  studentId: string;
  admissionNumber: string | null;
  studentName: string;
  classId: string;
  className: string;
  level: string;
  programme: string;
  status: 'READY' | 'SKIP';
  reason?: string;
  feeScheduleIds: string[];
  estimatedAmount: string;
};

@Injectable()
export class FinanceBillingRunService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(dto: BillingRunDto, roles: RoleName[]) {
    this.requireRole(roles);
    const context = await this.loadContext(dto);
    return this.buildCandidates(context, dto.includeOptional ?? false);
  }

  async execute(dto: BillingRunDto, actorUserId: string, roles: RoleName[]) {
    this.requireRole(roles);
    const context = await this.loadContext(dto);
    const prepared = this.buildCandidates(context, dto.includeOptional ?? false);
    if (prepared.readyCount === 0) {
      return { ...prepared, issuedCount: 0, invoices: [] };
    }

    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new BadRequestException('Invalid due date.');
    if (dueAt && dueAt < new Date()) {
      throw new BadRequestException('Due date cannot be earlier than the billing run execution time.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoices: Array<{ id: string; invoiceNumber: string; studentId: string; amount: string }> = [];
        for (const candidate of prepared.candidates.filter((entry) => entry.status === 'READY')) {
          const existing = await tx.studentInvoice.findFirst({
            where: {
              studentId: candidate.studentId,
              termId: dto.termId,
              status: { in: ['OPEN', 'PARTIALLY_PAID'] },
            },
            select: { id: true },
          });
          if (existing) continue;

          const schedules = await tx.feeSchedule.findMany({
            where: { id: { in: candidate.feeScheduleIds }, isActive: true },
          });
          if (schedules.length !== candidate.feeScheduleIds.length) {
            throw new ConflictException(`Fee schedule changed while billing ${candidate.studentName}. Re-run the preview.`);
          }

          const invoice = await tx.studentInvoice.create({
            data: {
              studentId: candidate.studentId,
              termId: dto.termId,
              invoiceNumber: this.nextInvoiceNumber(),
              dueAt: dueAt ?? undefined,
              lines: {
                create: schedules.map((schedule) => ({
                  feeScheduleId: schedule.id,
                  description: schedule.itemName,
                  amountDue: schedule.amount,
                })),
              },
            },
            include: { lines: true },
          });

          await tx.auditLog.create({
            data: {
              actorUserId,
              action: 'CREATE',
              entityType: 'StudentInvoice',
              entityId: invoice.id,
              afterJson: {
                billingRun: true,
                studentId: invoice.studentId,
                termId: invoice.termId,
                invoiceNumber: invoice.invoiceNumber,
                lineCount: invoice.lines.length,
                totalAmount: invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0)).toString(),
              },
            },
          });

          invoices.push({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            studentId: invoice.studentId,
            amount: invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0)).toFixed(2),
          });
        }

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'BillingRun',
            entityId: dto.termId,
            afterJson: {
              termId: dto.termId,
              classId: dto.classId ?? null,
              includeOptional: dto.includeOptional ?? false,
              candidateCount: prepared.candidates.length,
              issuedCount: invoices.length,
            },
          },
        });

        return { ...prepared, issuedCount: invoices.length, invoices };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Billing run conflicted with another financial operation. Re-run the preview and execute again.');
      }
      throw error;
    }
  }

  private async loadContext(dto: BillingRunDto) {
    const term = await this.prisma.term.findUnique({ where: { id: dto.termId } });
    if (!term) throw new NotFoundException('Term not found.');
    if (term.status === 'CLOSED') throw new BadRequestException('Billing cannot be generated for a closed term.');

    const [enrolments, schedules] = await Promise.all([
      this.prisma.enrolment.findMany({
        where: { termId: dto.termId, status: 'ACTIVE', ...(dto.classId ? { classId: dto.classId } : {}) },
        include: { student: { select: { id: true, admissionNumber: true, firstName: true, lastName: true, status: true } }, class: { select: { id: true, name: true } } },
        orderBy: [{ class: { name: 'asc' } }, { student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      }),
      this.prisma.feeSchedule.findMany({ where: { termId: dto.termId, isActive: true }, orderBy: [{ level: 'asc' }, { programme: 'asc' }, { itemCode: 'asc' }] }),
    ]);

    if (dto.classId && enrolments.length === 0) throw new NotFoundException('No active enrolments found for the selected class and term.');
    return { term, enrolments, schedules };
  }

  private buildCandidates(context: Awaited<ReturnType<FinanceBillingRunService['loadContext']>>, includeOptional: boolean) {
    const candidates: BillingCandidate[] = context.enrolments.map((enrolment) => {
      const schedules = context.schedules.filter((schedule) =>
        schedule.level === enrolment.level &&
        schedule.programme === enrolment.programme &&
        (includeOptional || !schedule.isOptional),
      );
      const amount = schedules.reduce((sum, schedule) => sum.plus(schedule.amount), new Prisma.Decimal(0));
      const studentName = `${enrolment.student.firstName} ${enrolment.student.lastName}`.trim();
      if (enrolment.student.status !== 'ACTIVE') {
        return { studentId: enrolment.student.id, admissionNumber: enrolment.student.admissionNumber, studentName, classId: enrolment.class.id, className: enrolment.class.name, level: enrolment.level, programme: enrolment.programme, status: 'SKIP', reason: 'STUDENT_NOT_ACTIVE', feeScheduleIds: [], estimatedAmount: '0.00' };
      }
      if (schedules.length === 0) {
        return { studentId: enrolment.student.id, admissionNumber: enrolment.student.admissionNumber, studentName, classId: enrolment.class.id, className: enrolment.class.name, level: enrolment.level, programme: enrolment.programme, status: 'SKIP', reason: 'NO_MATCHING_FEE_SCHEDULE', feeScheduleIds: [], estimatedAmount: '0.00' };
      }
      return { studentId: enrolment.student.id, admissionNumber: enrolment.student.admissionNumber, studentName, classId: enrolment.class.id, className: enrolment.class.name, level: enrolment.level, programme: enrolment.programme, status: 'READY', feeScheduleIds: schedules.map((schedule) => schedule.id), estimatedAmount: amount.toFixed(2) };
    });

    return {
      term: { id: context.term.id, code: context.term.code, name: context.term.name, status: context.term.status },
      candidates,
      candidateCount: candidates.length,
      readyCount: candidates.filter((candidate) => candidate.status === 'READY').length,
      skippedCount: candidates.filter((candidate) => candidate.status === 'SKIP').length,
      estimatedInvoicedAmount: candidates.filter((candidate) => candidate.status === 'READY').reduce((sum, candidate) => sum.plus(candidate.estimatedAmount), new Prisma.Decimal(0)).toFixed(2),
    };
  }

  private nextInvoiceNumber() {
    const year = new Date().getUTCFullYear();
    return `BCI-${year}-${randomBytes(5).toString('hex').toUpperCase()}`;
  }

  private requireRole(roles: RoleName[]) {
    if (!roles.some((role) => BILLING_ROLES.has(role))) throw new ForbiddenException('Billing run management is restricted.');
  }
}
