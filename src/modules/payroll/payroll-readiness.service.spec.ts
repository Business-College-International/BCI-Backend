import { PayrollPeriodStatus, Prisma, RoleName } from '@prisma/client';
import { PayrollReadinessService } from './payroll-readiness.service';

describe('PayrollReadinessService', () => {
  const prisma = {
    payrollPeriod: { findUnique: jest.fn() },
  } as any;

  const service = new PayrollReadinessService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('blocks an unapproved calculated period', async () => {
    prisma.payrollPeriod.findUnique.mockResolvedValue({
      id: 'period-1', code: 'SEP-2026', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30'),
      status: PayrollPeriodStatus.CALCULATED, approvedBy: null, approvedAt: null, paidAt: null,
      entries: [{
        id: 'entry-1', grossPay: new Prisma.Decimal('1000.10'), totalDeductions: new Prisma.Decimal('100.10'), netPay: new Prisma.Decimal('900.00'), status: 'calculated',
        staff: { staffIdNo: 'BCI-001', employmentStatus: 'active', person: { firstName: 'Ama', lastName: 'Mensah' } },
        disbursementAttempts: [],
      }],
    });

    const result = await service.getPeriodReadiness('period-1', [RoleName.ACCOUNTANT]);

    expect(result.ready).toBe(false);
    expect(result.findings.map((item) => item.code)).toContain('PERIOD_NOT_APPROVED');
  });

  it('uses exact decimal arithmetic for net-pay validation', async () => {
    prisma.payrollPeriod.findUnique.mockResolvedValue({
      id: 'period-2', code: 'OCT-2026', startsAt: new Date('2026-10-01'), endsAt: new Date('2026-10-31'),
      status: PayrollPeriodStatus.APPROVED, approvedBy: 'approver', approvedAt: new Date(), paidAt: null,
      entries: [{
        id: 'entry-2', grossPay: new Prisma.Decimal('1000.10'), totalDeductions: new Prisma.Decimal('0.10'), netPay: new Prisma.Decimal('1000.00'), status: 'approved',
        staff: { staffIdNo: 'BCI-002', employmentStatus: 'active', person: { firstName: 'Kojo', lastName: 'Boateng' } },
        disbursementAttempts: [],
      }],
    });

    const result = await service.getPeriodReadiness('period-2', [RoleName.DIRECTOR]);

    expect(result.findings.map((item) => item.code)).not.toContain('NET_PAY_MISMATCH');
    expect(result.summary.netTotal).toBe('1000.00');
    expect(result.ready).toBe(true);
  });

  it('flags a payroll period marked paid when an entry remains unpaid', async () => {
    prisma.payrollPeriod.findUnique.mockResolvedValue({
      id: 'period-3', code: 'NOV-2026', startsAt: new Date('2026-11-01'), endsAt: new Date('2026-11-30'),
      status: PayrollPeriodStatus.PAID, approvedBy: 'approver', approvedAt: new Date(), paidAt: new Date(),
      entries: [{
        id: 'entry-3', grossPay: new Prisma.Decimal('500'), totalDeductions: new Prisma.Decimal('0'), netPay: new Prisma.Decimal('500'), status: 'approved',
        staff: { staffIdNo: 'BCI-003', employmentStatus: 'active', person: { firstName: 'Esi', lastName: 'Owusu' } },
        disbursementAttempts: [],
      }],
    });

    const result = await service.getPeriodReadiness('period-3', [RoleName.PRINCIPAL]);

    expect(result.findings.map((item) => item.code)).toContain('PERIOD_PAID_WITH_UNPAID_ENTRY');
    expect(result.ready).toBe(false);
  });
});
