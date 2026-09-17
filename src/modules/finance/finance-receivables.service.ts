import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { ListInvoicesDto } from './dto/list-invoices.dto';
import { VoidInvoiceDto } from './dto/void-invoice.dto';

const FINANCE_MANAGEMENT_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.ACCOUNTANT, RoleName.OFFICE]);

@Injectable()
export class FinanceReceivablesService {
  constructor(private readonly prisma: PrismaService) {}

  async listInvoices(dto: ListInvoicesDto, actorUserId: string, roles: RoleName[]) {
    this.assertManagementScope(roles, actorUserId);
    const q = dto.q?.trim();
    const invoices = await this.prisma.studentInvoice.findMany({
      where: {
        ...(dto.termId ? { termId: dto.termId } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(q
          ? {
              OR: [
                { invoiceNumber: { contains: q, mode: 'insensitive' } },
                { student: { OR: [
                  { admissionNumber: { contains: q, mode: 'insensitive' } },
                  { firstName: { contains: q, mode: 'insensitive' } },
                  { lastName: { contains: q, mode: 'insensitive' } },
                ] } },
              ],
            }
          : {}),
      },
      include: {
        lines: true,
        allocations: { include: { payment: { select: { status: true } } } },
        student: { select: { admissionNumber: true, firstName: true, lastName: true } },
        term: { select: { id: true, code: true, name: true } },
      },
      orderBy: { issuedAt: 'desc' },
      take: 500,
    });

    return invoices.map((invoice) => {
      const due = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
      const allocated = invoice.allocations.reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        student: invoice.student,
        term: invoice.term,
        status: invoice.status,
        issuedAt: invoice.issuedAt,
        dueAt: invoice.dueAt,
        totalAmount: due.toFixed(2),
        allocatedAmount: allocated.toFixed(2),
        outstandingAmount: due.minus(allocated).toFixed(2),
      };
    });
  }

  async voidInvoice(invoiceId: string, dto: VoidInvoiceDto, actorUserId: string, roles: RoleName[]) {
    this.assertManagementScope(roles, actorUserId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const invoice = await tx.studentInvoice.findUnique({
          where: { id: invoiceId },
          include: { allocations: true },
        });
        if (!invoice) throw new NotFoundException('Invoice not found.');
        if (invoice.status === InvoiceStatus.VOID) throw new ConflictException('Invoice is already void.');
        if (invoice.status === InvoiceStatus.PAID || invoice.allocations.length > 0) {
          throw new BadRequestException('Invoices with allocated payments cannot be voided. Use the payment/refund workflow instead.');
        }

        const updated = await tx.studentInvoice.updateMany({
          where: {
            id: invoiceId,
            status: invoice.status,
            allocations: { none: {} },
          },
          data: { status: InvoiceStatus.VOID },
        });
        if (updated.count !== 1) {
          throw new ConflictException('Invoice changed concurrently. Please reload and retry.');
        }

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'UPDATE',
            entityType: 'StudentInvoice',
            entityId: invoiceId,
            beforeJson: { status: invoice.status },
            afterJson: { status: InvoiceStatus.VOID, reason: dto.reason.trim() },
          },
        });
        return { success: true, invoiceId, status: InvoiceStatus.VOID };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Invoice changed concurrently. Please reload and retry.');
      }
      throw error;
    }
  }

  async ageing(actorUserId: string, roles: RoleName[], asOf = new Date()) {
    this.assertManagementScope(roles, actorUserId);
    const invoices = await this.prisma.studentInvoice.findMany({
      where: { status: { in: [InvoiceStatus.OPEN, InvoiceStatus.PARTIALLY_PAID] } },
      include: { lines: true, allocations: true, student: { select: { id: true, admissionNumber: true, firstName: true, lastName: true } } },
    });

    const buckets = { current: new Prisma.Decimal(0), days1to30: new Prisma.Decimal(0), days31to60: new Prisma.Decimal(0), days61to90: new Prisma.Decimal(0), over90: new Prisma.Decimal(0) };
    const rows: Array<{ invoiceId: string; invoiceNumber: string; student: unknown; dueAt: Date | null; outstandingAmount: string; bucket: string }> = [];

    for (const invoice of invoices) {
      const due = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
      const allocated = invoice.allocations.reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
      const outstanding = due.minus(allocated);
      if (outstanding.lte(0)) continue;
      const ageDays = invoice.dueAt ? Math.max(0, Math.floor((asOf.getTime() - invoice.dueAt.getTime()) / 86_400_000)) : 0;
      let bucket: keyof typeof buckets = 'current';
      if (ageDays > 90) bucket = 'over90';
      else if (ageDays > 60) bucket = 'days61to90';
      else if (ageDays > 30) bucket = 'days31to60';
      else if (ageDays > 0) bucket = 'days1to30';
      buckets[bucket] = buckets[bucket].plus(outstanding);
      rows.push({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, student: invoice.student, dueAt: invoice.dueAt, outstandingAmount: outstanding.toFixed(2), bucket });
    }

    return {
      asOf: asOf.toISOString(),
      totals: {
        current: buckets.current.toFixed(2),
        days1to30: buckets.days1to30.toFixed(2),
        days31to60: buckets.days31to60.toFixed(2),
        days61to90: buckets.days61to90.toFixed(2),
        over90: buckets.over90.toFixed(2),
        outstanding: Object.values(buckets).reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(2),
      },
      rows: rows.sort((a, b) => Number(b.outstandingAmount) - Number(a.outstandingAmount)).slice(0, 500),
    };
  }

  private assertManagementScope(roles: RoleName[], actorUserId: string) {
    if (!roles.some((role) => FINANCE_MANAGEMENT_ROLES.has(role))) {
      throw new ForbiddenException(`Finance management access is restricted for user ${actorUserId}.`);
    }
  }
}
