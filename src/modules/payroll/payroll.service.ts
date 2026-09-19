import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const PAYROLL_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.ACCOUNTANT,
]);

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyPayroll(userId: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { userId },
      select: { personId: true, staffIdNo: true },
    });
    if (!staff) throw new NotFoundException('Staff profile not found for this account.');

    const [salary, entries] = await Promise.all([
      this.prisma.salaryStructure.findUnique({
        where: { staffId: staff.personId },
        select: {
          basePay: true,
          allowances: true,
          deductions: true,
          effectiveAt: true,
          endedAt: true,
        },
      }),
      this.prisma.payrollEntry.findMany({
        where: { staffId: staff.personId },
        include: {
          period: { select: { id: true, code: true, startsAt: true, endsAt: true, status: true, paidAt: true } },
          disbursementAttempts: { select: { id: true, amount: true, status: true, requestedAt: true, completedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      staffIdNo: staff.staffIdNo,
      salary: salary
        ? {
            basePay: salary.basePay.toString(),
            allowances: salary.allowances,
            deductions: salary.deductions,
            effectiveAt: salary.effectiveAt,
            endedAt: salary.endedAt,
          }
        : null,
      payrollEntries: entries.map((entry) => ({
        id: entry.id,
        grossPay: entry.grossPay.toString(),
        totalDeductions: entry.totalDeductions.toString(),
        netPay: entry.netPay.toString(),
        status: entry.status,
        period: entry.period,
        disbursements: entry.disbursementAttempts.map((attempt) => ({
          id: attempt.id,
          amount: attempt.amount.toString(),
          status: attempt.status,
          requestedAt: attempt.requestedAt,
          completedAt: attempt.completedAt,
        })),
      })),
    };
  }

  async listPayrollPeriods(roles: RoleName[]) {
    if (!roles.some((role) => PAYROLL_ROLES.has(role))) {
      throw new ForbiddenException('Payroll period access is restricted.');
    }

    const periods = await this.prisma.payrollPeriod.findMany({
      include: {
        _count: { select: { entries: true, disbursements: true } },
      },
      orderBy: { startsAt: 'desc' },
    });

    return periods.map((period) => ({
      id: period.id,
      code: period.code,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      status: period.status,
      approvedAt: period.approvedAt,
      paidAt: period.paidAt,
      staffEntryCount: period._count.entries,
      disbursementCount: period._count.disbursements,
    }));
  }

  async listPayrollPeriodEntries(periodId: string, roles: RoleName[]) {
    if (!roles.some((role) => PAYROLL_ROLES.has(role))) {
      throw new ForbiddenException('Payroll entries are restricted.');
    }

    const period = await this.prisma.payrollPeriod.findUnique({
      where: { id: periodId },
      include: {
        entries: {
          include: {
            staff: {
              select: {
                staffIdNo: true,
                person: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { staff: { staffIdNo: 'asc' } },
        },
      },
    });
    if (!period) throw new NotFoundException('Payroll period not found.');

    return {
      period: {
        id: period.id,
        code: period.code,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        status: period.status,
        calculatedBy: period.calculatedBy,
        calculatedAt: period.calculatedAt,
        approvedBy: period.approvedBy,
        approvedAt: period.approvedAt,
        paidAt: period.paidAt,
      },
      entries: period.entries.map((entry) => ({
        id: entry.id,
        staffIdNo: entry.staff.staffIdNo,
        staffName: `${entry.staff.person.firstName} ${entry.staff.person.lastName}`,
        grossPay: entry.grossPay.toString(),
        totalDeductions: entry.totalDeductions.toString(),
        netPay: entry.netPay.toString(),
        status: entry.status,
      })),
    };
  }
}
