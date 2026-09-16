import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, PaymentPurpose, RoleName, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const PRIVILEGED_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
  RoleName.ACCOUNTANT,
]);

@Injectable()
export class FinanceStatementService {
  constructor(private readonly prisma: PrismaService) {}

  async getStudentStatement(studentId: string, actorUserId: string, roles: RoleName[]) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        admissionNumber: true,
        firstName: true,
        lastName: true,
        guardians: {
          select: { guardian: { select: { userId: true } }, canPayFees: true },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found.');

    const privileged = roles.some((role) => PRIVILEGED_ROLES.has(role));
    const guardianLink = student.guardians.find((link) => link.guardian.userId === actorUserId);
    if (!privileged && !guardianLink) {
      throw new ForbiddenException("You do not have access to this student's fee statement.");
    }
    if (!privileged && guardianLink && !guardianLink.canPayFees) {
      throw new ForbiddenException('This guardian is not permitted to view or pay fees for this ward.');
    }

    const [invoices, payments] = await Promise.all([
      this.prisma.studentInvoice.findMany({
        where: { studentId },
        include: {
          term: { select: { id: true, code: true, name: true, startsAt: true, endsAt: true } },
          lines: { select: { id: true, description: true, amountDue: true } },
          allocations: {
            where: { payment: { status: PaymentStatus.SUCCEEDED, purpose: PaymentPurpose.FEE } },
            select: {
              amount: true,
              payment: { select: { id: true, status: true, completedAt: true, receipt: true } },
            },
          },
        },
        orderBy: { issuedAt: 'desc' },
      }),
      this.prisma.payment.findMany({
        where: { studentId, status: PaymentStatus.SUCCEEDED, purpose: PaymentPurpose.FEE },
        include: {
          receipt: true,
          allocations: {
            where: { invoice: { studentId } },
            include: { invoice: { select: { invoiceNumber: true } } },
          },
        },
        orderBy: { completedAt: 'desc' },
      }),
    ]);

    const invoiceViews = invoices.map((invoice) => {
      const totalDue = invoice.lines.reduce((sum, line) => sum.plus(line.amountDue), new Prisma.Decimal(0));
      const paid = invoice.allocations.reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
      const outstanding = Prisma.Decimal.max(totalDue.minus(paid), new Prisma.Decimal(0));
      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        term: invoice.term,
        status: invoice.status,
        issuedAt: invoice.issuedAt,
        dueAt: invoice.dueAt,
        notes: invoice.notes,
        totalDue: totalDue.toFixed(2),
        paid: paid.toFixed(2),
        outstanding: outstanding.toFixed(2),
        lines: invoice.lines.map((line) => ({
          id: line.id,
          description: line.description,
          amountDue: line.amountDue.toFixed(2),
        })),
        allocations: invoice.allocations.map((allocation) => ({
          amount: allocation.amount.toFixed(2),
          completedAt: allocation.payment.completedAt,
          paymentId: allocation.payment.id,
        })),
      };
    });

    const totalDue = invoiceViews.reduce((sum, invoice) => sum.plus(invoice.totalDue), new Prisma.Decimal(0));
    const totalPaid = invoiceViews.reduce((sum, invoice) => sum.plus(invoice.paid), new Prisma.Decimal(0));
    const totalOutstanding = Prisma.Decimal.max(totalDue.minus(totalPaid), new Prisma.Decimal(0));

    return {
      student: {
        id: student.id,
        admissionNumber: student.admissionNumber,
        name: `${student.firstName} ${student.lastName}`,
      },
      summary: {
        totalDue: totalDue.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        totalOutstanding: totalOutstanding.toFixed(2),
      },
      invoices: invoiceViews,
      receipts: payments.map((payment) => ({
        paymentId: payment.id,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        purpose: payment.purpose,
        completedAt: payment.completedAt,
        receipt: payment.receipt
          ? {
              receiptNumber: payment.receipt.receiptNumber,
              fileUrl: payment.receipt.fileUrl,
              issuedAt: payment.receipt.issuedAt,
            }
          : null,
        allocations: payment.allocations.map((allocation) => ({
          invoiceNumber: allocation.invoice.invoiceNumber,
          amount: allocation.amount.toFixed(2),
        })),
      })),
    };
  }
}
