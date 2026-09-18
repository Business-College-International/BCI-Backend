import { ForbiddenException } from '@nestjs/common';
import { DisbursementStatus, PayrollPeriodStatus, Prisma, RoleName } from '@prisma/client';
import { PayrollDisbursementService } from './payroll-disbursement.service';

function makeTx() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    payrollEntry: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    payrollPeriod: { findUnique: jest.fn(), updateMany: jest.fn() },
    disbursementAttempt: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
}

function makePrisma(tx: ReturnType<typeof makeTx>) {
  return {
    $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    disbursementAttempt: tx.disbursementAttempt,
  } as any;
}

describe('PayrollDisbursementService', () => {
  it('requires payroll management role and idempotency key', async () => {
    const tx = makeTx();
    const service = new PayrollDisbursementService(makePrisma(tx), {} as any);

    await expect(service.initiate('entry-1', 'user-1', [RoleName.TEACHER], 'key'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reserves only the remaining approved payroll amount and disburses exactly once', async () => {
    const tx = makeTx();
    tx.payrollEntry.findUnique.mockResolvedValue({
      id: 'entry-1',
      status: 'approved',
      netPay: new Prisma.Decimal('5000.00'),
      period: { id: 'period-1', status: PayrollPeriodStatus.APPROVED, code: '2026-09' },
      staff: { personId: 'staff-1', staffIdNo: 'ST-1', employmentStatus: 'active', person: { phone: '0244000000' } },
      disbursementAttempts: [{ id: 'old-1', status: DisbursementStatus.SUCCEEDED, amount: new Prisma.Decimal('1000.00'), purpose: 'PAYROLL' }],
    });
    tx.disbursementAttempt.create.mockResolvedValue({ id: 'attempt-1' });
    const provider = { initiateTransfer: jest.fn().mockResolvedValue({ providerReference: 'moolre-1', status: 'PENDING', mock: true }) };

    const service = new PayrollDisbursementService(makePrisma(tx), provider as any);
    const result = await service.initiate('entry-1', 'user-1', [RoleName.ACCOUNTANT], 'key-1');

    expect(tx.disbursementAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: new Prisma.Decimal('4000.00'), status: DisbursementStatus.PROCESSING, purpose: 'PAYROLL', idempotencyKey: 'key-1' }),
    }));
    expect(result).toMatchObject({ attemptId: 'attempt-1', status: DisbursementStatus.PROCESSING, providerReference: 'moolre-1' });
  });

  it('reconciles a successful provider result into paid entry and paid period when all entries are settled', async () => {
    const tx = makeTx();
    tx.disbursementAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1',
      status: DisbursementStatus.PROCESSING,
      providerReference: 'moolre-1',
      payrollPeriodId: 'period-1',
      payrollEntryId: 'entry-1',
      payrollEntry: { netPay: new Prisma.Decimal('1000.00') },
    });
    tx.disbursementAttempt.updateMany.mockResolvedValue({ count: 1 });
    tx.payrollEntry.findUnique
      .mockResolvedValueOnce({
        id: 'entry-1',
        netPay: new Prisma.Decimal('1000.00'),
        disbursementAttempts: [{ amount: new Prisma.Decimal('1000.00'), status: DisbursementStatus.SUCCEEDED }],
      });
    tx.payrollEntry.findMany.mockResolvedValue([
      { id: 'entry-1', netPay: new Prisma.Decimal('1000.00'), status: 'approved', disbursementAttempts: [{ amount: new Prisma.Decimal('1000.00'), status: DisbursementStatus.SUCCEEDED }] },
    ]);
    tx.auditLog.create.mockResolvedValue({});
    const provider = { getTransferStatus: jest.fn().mockResolvedValue({ providerReference: 'moolre-1', status: 'SUCCESSFUL', mock: true }) };

    const service = new PayrollDisbursementService(makePrisma(tx), provider as any);
    const result = await service.reconcile('attempt-1', 'user-1', [RoleName.ACCOUNTANT]);

    expect(tx.payrollEntry.updateMany).toHaveBeenCalledWith({
      where: { id: 'entry-1', status: 'approved' },
      data: { status: 'paid' },
    });
    expect(tx.payrollPeriod.updateMany).toHaveBeenCalledWith({
      where: { id: 'period-1', status: PayrollPeriodStatus.APPROVED },
      data: expect.objectContaining({ status: PayrollPeriodStatus.PAID }),
    });
    expect(result.status).toBe(DisbursementStatus.SUCCEEDED);
  });
});
