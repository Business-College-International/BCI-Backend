import { BadRequestException } from '@nestjs/common';
import { PayrollPeriodStatus, RoleName } from '@prisma/client';
import { PayrollCalculatorService } from './payroll-calculator.service';

function makeTx() {
  return {
    payrollPeriod: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    staff: {
      findMany: jest.fn(),
    },
    payrollEntry: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  return {
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  } as any;
}

const managerRoles = [RoleName.ACCOUNTANT];

function makePeriod() {
  return {
    id: 'period-1',
    code: '2026-09',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2026-09-30T23:59:59Z'),
    status: PayrollPeriodStatus.DRAFT,
  };
}

function makeStaff(salary: { effectiveAt: string; endedAt: string | null }) {
  return {
    personId: 'staff-1',
    staffIdNo: 'STAFF-001',
    employmentStatus: 'active',
    salary: {
      basePay: '5000.00',
      allowances: [],
      deductions: [],
      effectiveAt: new Date(salary.effectiveAt),
      endedAt: salary.endedAt ? new Date(salary.endedAt) : null,
    },
  };
}

describe('PayrollCalculatorService salary-period integrity', () => {
  it('blocks an active staff member whose salary ended before the payroll period', async () => {
    const tx = makeTx();
    tx.payrollPeriod.findUnique.mockResolvedValue(makePeriod());
    tx.staff.findMany.mockResolvedValue([
      makeStaff({ effectiveAt: '2026-01-01T00:00:00Z', endedAt: '2026-08-31T23:59:59Z' }),
    ]);

    const service = new PayrollCalculatorService(makePrisma(tx));

    await expect(service.calculate('period-1', 'user-1', managerRoles))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payrollEntry.upsert).not.toHaveBeenCalled();
    expect(tx.payrollPeriod.update).not.toHaveBeenCalled();
  });

  it('blocks a salary structure that starts after the payroll period ends', async () => {
    const tx = makeTx();
    tx.payrollPeriod.findUnique.mockResolvedValue(makePeriod());
    tx.staff.findMany.mockResolvedValue([
      makeStaff({ effectiveAt: '2026-10-01T00:00:00Z', endedAt: null }),
    ]);

    const service = new PayrollCalculatorService(makePrisma(tx));

    await expect(service.calculate('period-1', 'user-1', managerRoles))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payrollEntry.upsert).not.toHaveBeenCalled();
    expect(tx.payrollPeriod.update).not.toHaveBeenCalled();
  });

  it('calculates payroll when the salary structure overlaps the payroll period', async () => {
    const tx = makeTx();
    tx.payrollPeriod.findUnique.mockResolvedValue(makePeriod());
    tx.staff.findMany.mockResolvedValue([
      makeStaff({ effectiveAt: '2026-01-01T00:00:00Z', endedAt: null }),
    ]);
    tx.payrollPeriod.update.mockResolvedValue({ status: PayrollPeriodStatus.CALCULATED });

    const service = new PayrollCalculatorService(makePrisma(tx));
    const result = await service.calculate('period-1', 'user-1', managerRoles);

    expect(result).toEqual({ periodId: 'period-1', status: PayrollPeriodStatus.CALCULATED, staffCount: 1 });
    expect(tx.payrollEntry.upsert).toHaveBeenCalledTimes(1);
    expect(tx.payrollPeriod.update).toHaveBeenCalledTimes(1);
  });
});
