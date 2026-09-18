import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollPeriodStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { calculateCompensation } from './payroll-calculator';

const MANAGEMENT_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.ACCOUNTANT, RoleName.PRINCIPAL]);

@Injectable()
export class PayrollCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(periodId: string, actorUserId: string, roles: RoleName[]) {
    this.requireManagement(roles);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PayrollPeriod" WHERE id = ${periodId} FOR UPDATE`;
        const period = await tx.payrollPeriod.findUnique({ where: { id: periodId } });
        if (!period) throw new NotFoundException('Payroll period not found.');
        if (period.status !== PayrollPeriodStatus.DRAFT) throw new BadRequestException('Only draft payroll periods can be calculated.');

        const staff = await tx.staff.findMany({
          where: { employmentStatus: 'active', salary: { isNot: null } },
          include: { salary: true },
          orderBy: { staffIdNo: 'asc' },
        });
        if (staff.length === 0) throw new BadRequestException('No active staff with salary structures are available for calculation.');

        const ineligible = staff.filter((member) => {
          const salary = member.salary!;
          return salary.effectiveAt > period.endsAt
            || (salary.endedAt !== null && salary.endedAt < period.startsAt);
        });
        if (ineligible.length > 0) {
          throw new BadRequestException(
            `Active staff have salary structures that do not apply to payroll period ${period.code}: ${ineligible.map((member) => member.staffIdNo).join(', ')}.`,
          );
        }

        for (const member of staff) {
          const salary = member.salary!;
          const calculation = calculateCompensation({ basePay: salary.basePay, allowances: salary.allowances, deductions: salary.deductions });
          await tx.payrollEntry.upsert({
            where: { periodId_staffId: { periodId, staffId: member.personId } },
            update: {
              grossPay: calculation.grossPay,
              totalDeductions: calculation.deductionsTotal,
              netPay: calculation.netPay,
              calculationJson: calculation,
              status: 'calculated',
            },
            create: {
              periodId,
              staffId: member.personId,
              grossPay: calculation.grossPay,
              totalDeductions: calculation.deductionsTotal,
              netPay: calculation.netPay,
              calculationJson: calculation,
              status: 'calculated',
            },
          });
        }

        const calculatedAt = new Date();
        const updated = await tx.payrollPeriod.update({
          where: { id: periodId },
          data: {
            status: PayrollPeriodStatus.CALCULATED,
            calculatedBy: actorUserId,
            calculatedAt,
            approvedBy: null,
            approvedAt: null,
          },
        });
        await tx.auditLog.create({
          data: { actorUserId, action: 'UPDATE', entityType: 'PayrollPeriod', entityId: periodId, afterJson: { status: updated.status, staffCount: staff.length } },
        });
        return { periodId, status: updated.status, staffCount: staff.length };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Payroll period changed concurrently. Please retry the calculation.');
      }
      throw error;
    }
  }

  async approve(periodId: string, actorUserId: string, roles: RoleName[]) {
    this.requireManagement(roles);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PayrollPeriod" WHERE id = ${periodId} FOR UPDATE`;
        const period = await tx.payrollPeriod.findUnique({ where: { id: periodId } });
        if (!period) throw new NotFoundException('Payroll period not found.');
        if (period.status !== PayrollPeriodStatus.CALCULATED) throw new BadRequestException('Only calculated payroll periods can be approved.');
        if (!period.calculatedBy || !period.calculatedAt) throw new BadRequestException('Payroll calculation provenance is incomplete.');
        if (period.calculatedBy === actorUserId) throw new ForbiddenException('The payroll calculator cannot approve the same payroll period.');

        const entries = await tx.payrollEntry.findMany({
          where: { periodId },
          select: {
            id: true,
            grossPay: true,
            totalDeductions: true,
            netPay: true,
            status: true,
            staff: {
              select: {
                staffIdNo: true,
                employmentStatus: true,
              },
            },
          },
          orderBy: { staffId: 'asc' },
        });

        if (entries.length === 0) {
          throw new BadRequestException('Payroll period cannot be approved without payroll entries.');
        }

        const invalidEntry = entries.find((entry) => {
          const gross = entry.grossPay;
          const deductions = entry.totalDeductions;
          const net = entry.netPay;
          return entry.status !== 'calculated'
            || entry.staff.employmentStatus !== 'active'
            || gross.isNegative()
            || deductions.isNegative()
            || deductions.gt(gross)
            || !gross.sub(deductions).eq(net);
        });

        if (invalidEntry) {
          throw new BadRequestException(
            `Payroll entry ${invalidEntry.staff.staffIdNo} failed approval integrity checks. Recalculate or correct the entry before approval.`,
          );
        }

        const updated = await tx.payrollPeriod.update({ where: { id: periodId }, data: { status: PayrollPeriodStatus.APPROVED, approvedBy: actorUserId, approvedAt: new Date() } });
        await tx.payrollEntry.updateMany({ where: { periodId }, data: { status: 'approved' } });
        await tx.auditLog.create({
          data: { actorUserId, action: 'APPROVE', entityType: 'PayrollPeriod', entityId: periodId, beforeJson: { status: period.status }, afterJson: { status: updated.status, approvedAt: updated.approvedAt } },
        });
        return { periodId, status: updated.status, approvedAt: updated.approvedAt };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Payroll period changed concurrently. Please retry the approval.');
      }
      throw error;
    }
  }

  private requireManagement(roles: RoleName[]) {
    if (!roles.some((role) => MANAGEMENT_ROLES.has(role))) throw new ForbiddenException('Payroll management access is restricted.');
  }
}
