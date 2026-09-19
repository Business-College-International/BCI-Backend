import { Injectable, NotFoundException } from '@nestjs/common';
import { PayrollPeriodStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const MANAGEMENT_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.ACCOUNTANT,
  RoleName.PRINCIPAL,
]);

type Finding = {
  code: string;
  payrollEntryId?: string;
  staffIdNo?: string;
  message: string;
};

@Injectable()
export class PayrollReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async getPeriodReadiness(periodId: string, roles: RoleName[]) {
    if (!roles.some((role) => MANAGEMENT_ROLES.has(role))) {
      throw new NotFoundException('Payroll readiness is not available for this account.');
    }

    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      include: {
        entries: {
          include: {
            staff: {
              select: {
                staffIdNo: true,
                employmentStatus: true,
                person: { select: { firstName: true, lastName: true } },
              },
            },
            disbursementAttempts: {
              select: { id: true, amount: true, status: true, requestedAt: true, completedAt: true },
              orderBy: { requestedAt: 'desc' },
            },
          },
          orderBy: { staff: { staffIdNo: 'asc' } },
        },
      },
    });

    if (!period) throw new NotFoundException('Payroll period not found.');

    const findings: Finding[] = [];
    let grossTotal = new Prisma.Decimal(0);
    let deductionsTotal = new Prisma.Decimal(0);
    let netTotal = new Prisma.Decimal(0);
    let disbursedTotal = new Prisma.Decimal(0);

    if (period.status === PayrollPeriodStatus.DRAFT) {
      findings.push({ code: 'PERIOD_NOT_CALCULATED', message: 'The payroll period is still in DRAFT state.' });
    }
    if (period.status !== PayrollPeriodStatus.DRAFT && (!period.calculatedBy || !period.calculatedAt)) {
      findings.push({ code: 'CALCULATION_PROVENANCE_MISSING', message: 'Payroll calculation provenance is incomplete.' });
    }
    if (period.status === PayrollPeriodStatus.CALCULATED && !period.approvedAt) {
      findings.push({ code: 'PERIOD_NOT_APPROVED', message: 'Payroll has been calculated but not approved.' });
    }
    if ((period.status === PayrollPeriodStatus.APPROVED || period.status === PayrollPeriodStatus.PAID) && (!period.approvedBy || !period.approvedAt)) {
      findings.push({ code: 'APPROVAL_PROVENANCE_MISSING', message: 'Payroll approval provenance is incomplete.' });
    }
    if (period.status !== PayrollPeriodStatus.DRAFT && period.entries.length === 0) {
      findings.push({ code: 'NO_PAYROLL_ENTRIES', message: 'The payroll period has no staff entries.' });
    }

    for (const entry of period.entries) {
      const gross = new Prisma.Decimal(entry.grossPay);
      const deductions = new Prisma.Decimal(entry.totalDeductions);
      const net = new Prisma.Decimal(entry.netPay);
      grossTotal = grossTotal.add(gross);
      deductionsTotal = deductionsTotal.add(deductions);
      netTotal = netTotal.add(net);

      if (gross.isNegative()) {
        findings.push({ code: 'GROSS_PAY_INVALID', payrollEntryId: entry.id, staffIdNo: entry.staff.staffIdNo, message: 'Gross pay is negative.' });
      }
      if (deductions.isNegative()) {
        findings.push({ code: 'DEDUCTIONS_INVALID', payrollEntryId: entry.id, staffIdNo: entry.staff.staffIdNo, message: 'Deductions are negative.' });
      }
      if (deductions.gt(gross)) {
        findings.push({ code: 'DEDUCTIONS_EXCEED_GROSS', payrollEntryId: entry.id, staffIdNo: entry.staff.staffIdNo, message: 'Total deductions exceed gross pay.' });
      }
      if (!gross.sub(deductions).eq(net)) {
        findings.push({ code: 'NET_PAY_MISMATCH', payrollEntryId: entry.id, staffIdNo: entry.staff.staffIdNo, message: 'Net pay does not equal gross pay minus deductions.' });
      }
      if (entry.staff.employmentStatus !== 'active') {
        findings.push({ code: 'STAFF_NOT_ACTIVE', payrollEntryId: entry.id, staffIdNo: entry.staff.staffIdNo, message: `Staff employment status is ${entry.staff.employmentStatus}.` });
      }
      if (period.status === PayrollPeriodStatus.APPROVED && entry.status !== 'approved') {
        findings.push({ code: 'ENTRY_NOT_APPROVED', payrollEntryId: entry.id, staffIdNo: entry.staff.staffIdNo, message: `Entry status is ${entry.status}, not approved.` });
      }

      const succeeded = entry.disbursementAttempts.filter((attempt) => attempt.status === 'SUCCEEDED');
      const processing = entry.disbursementAttempts.filter((attempt) => attempt.status === 'PROCESSING');
      const paidAmount = succeeded.reduce((sum, attempt) => sum.add(attempt.amount), new Prisma.Decimal(0));
      disbursedTotal = disbursedTotal.add(paidAmount);
      if (paidAmount.gt(net)) {
        findings.push({ code: 'DISBURSEMENT_OVER_NET', payrollEntryId: entry.id, staffIdNo: entry.staff.staffIdNo, message: 'Successful disbursements exceed the net payroll amount.' });
      }
      if (processing.length > 1) {
        findings.push({ code: 'MULTIPLE_PROCESSING_DISBURSEMENTS', payrollEntryId: entry.id, staffIdNo: entry.staff.staffIdNo, message: 'More than one processing disbursement exists for the payroll entry.' });
      }
      if (period.status === PayrollPeriodStatus.PAID && paidAmount.lt(net)) {
        findings.push({ code: 'PERIOD_PAID_WITH_UNPAID_ENTRY', payrollEntryId: entry.id, staffIdNo: entry.staff.staffIdNo, message: 'The period is marked PAID but this entry is not fully disbursed.' });
      }
    }

    const outstanding = Prisma.Decimal.max(new Prisma.Decimal(0), netTotal.sub(disbursedTotal));

    return {
      period: {
        id: period.id,
        code: period.code,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        status: period.status,
        approvedBy: period.approvedBy,
        approvedAt: period.approvedAt,
        paidAt: period.paidAt,
      },
      summary: {
        entryCount: period.entries.length,
        grossTotal: grossTotal.toFixed(2),
        deductionsTotal: deductionsTotal.toFixed(2),
        netTotal: netTotal.toFixed(2),
        successfulDisbursementTotal: disbursedTotal.toFixed(2),
        outstandingDisbursementTotal: outstanding.toFixed(2),
      },
      ready: findings.length === 0 && period.status === PayrollPeriodStatus.APPROVED,
      findings,
      entries: period.entries.map((entry) => ({
        id: entry.id,
        staffIdNo: entry.staff.staffIdNo,
        staffName: `${entry.staff.person.firstName} ${entry.staff.person.lastName}`,
        employmentStatus: entry.staff.employmentStatus,
        grossPay: entry.grossPay.toString(),
        totalDeductions: entry.totalDeductions.toString(),
        netPay: entry.netPay.toString(),
        status: entry.status,
        successfulDisbursementTotal: entry.disbursementAttempts
          .filter((attempt) => attempt.status === 'SUCCEEDED')
          .reduce((sum, attempt) => sum.add(attempt.amount), new Prisma.Decimal(0))
          .toFixed(2),
        disbursementAttempts: entry.disbursementAttempts.map((attempt) => ({
          id: attempt.id,
          amount: attempt.amount.toString(),
          status: attempt.status,
          requestedAt: attempt.requestedAt,
          completedAt: attempt.completedAt,
        })),
      })),
    };
  }
}
