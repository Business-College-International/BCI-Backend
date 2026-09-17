import { BadRequestException, ConflictException } from '@nestjs/common';
import { PayrollPeriodStatus, Prisma, RoleName } from '@prisma/client';
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
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>, transactionError?: unknown) {
  return {
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown, options: unknown) => {
      if (transactionError) throw transactionError;
      expect(options).toEqual(expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }));
      return callback(tx);
    }),
  } as any;
}

const managerRoles = [RoleName.ACCOUNTANT];

function makePeriod(status: PayrollPeriodStatus = PayrollPeriodStatus.DRAFT) {
  return {
    id: 'period-1',
    code: '2026-09',
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2026-09-30T23:59:59Z'),
    status,
    approvedBy: null,
    approvedAt: null,
  };
}

function makeStaff(salary: { effectiveAt: string; endedAt: string | null }) {
  return {
    personId: 'staff-1',
    staffIdNo: 'STAFF-001',
    employmentStatus: 'active',
    salary: {
      basePay: new Prisma.Decimal('5000.00'),
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

  it('turns a concurrent calculation into a retryable conflict', async () => {
    const service = new PayrollCalculatorService(makePrisma(makeTx(), { code: 'P2034' }));

    await expect(service.calculate('period-1', 'user-1', managerRoles))
      .rejects.toEqual(expect.objectContaining({ message: 'Payroll period changed concurrently. Please retry the calculation.' }));
  });
});

describe('PayrollCalculatorService approval integrity', () => {
  function makeApprovedPeriod() {
    return makePeriod(PayrollPeriodStatus.CALCULATED);
  }

  function makeEntry(overrides: Partial<{
    grossPay: string;
    totalDeductions: string;
    netPay: string;
    status: string;
    employmentStatus: string;
  }> = {}) {
    const grossPay = new Prisma.Decimal(overrides.grossPay ?? '6000.00');
    const totalDeductions = new Prisma.Decimal(overrides.totalDeductions ?? '500.00');
    const netPay = new Prisma.Decimal(overrides.netPay ?? '5500.00');
    return {
      id: 'entry-1',
      grossPay,
      totalDeductions,
      netPay,
      status: overrides.status ?? 'calculated',
      staff: {
        staffIdNo: 'STAFF-001',
        employmentStatus: overrides.employmentStatus ?? 'active',
      },
    };
  }

  it('approves a consistent calculated payroll period', async () => {
    const tx = makeTx();
    tx.payrollPeriod.findUnique.mockResolvedValue(makeApprovedPeriod());
    tx.payrollEntry.findMany.mockResolvedValue([makeEntry()]);
    tx.payrollPeriod.update.mockResolvedValue({
      status: PayrollPeriodStatus.APPROVED,
      approvedAt: new Date('2026-09-17T15:20:00Z'),
    });

    const service = new PayrollCalculatorService(makePrisma(tx));
    const result = await service.approve('period-1', 'approver-user', managerRoles);

    expect(result.status).toBe(PayrollPeriodStatus.APPROVED);
    expect(tx.payrollPeriod.update).toHaveBeenCalledTimes(1);
    expect(tx.payrollEntry.updateMany).toHaveBeenCalledWith({
      where: { periodId: 'period-1' },
      data: { status: 'approved' },
    });
  });

  it('blocks approval when net pay does not equal gross pay minus deductions', async () => {
    const tx = makeTx();
    tx.payrollPeriod.findUnique.mockResolvedValue(makeApprovedPeriod());
    tx.payrollEntry.findMany.mockResolvedValue([makeEntry({ netPay: '5400.00' })]);

    const service = new PayrollCalculatorService(makePrisma(tx));

    await expect(service.approve('period-1', 'approver-user', managerRoles))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payrollPeriod.update).not.toHaveBeenCalled();
    expect(tx.payrollEntry.updateMany).not.toHaveBeenCalled();
  });

  it('blocks approval when a payroll entry belongs to inactive staff', async () => {
    const tx = makeTx();
    tx.payrollPeriod.findUnique.mockResolvedValue(makeApprovedPeriod());
    tx.payrollEntry.findMany.mockResolvedValue([makeEntry({ employmentStatus: 'inactive' })]);

    const service = new PayrollCalculatorService(makePrisma(tx));

    await expect(service.approve('period-1', 'approver-user', managerRoles))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payrollPeriod.update).not.toHaveBeenCalled();
    expect(tx.payrollEntry.updateMany).not.toHaveBeenCalled();
  });

  it('turns a concurrent approval into a retryable conflict', async () => {
    const service = new PayrollCalculatorService(makePrisma(makeTx(), { code: 'P2034' }));

    await expect(service.approve('period-1', 'approver-user', managerRoles))
      .rejects.toEqual(expect.objectContaining({ message: 'Payroll period changed concurrently. Please retry the approval.' }));
  });
});
