import { ForbiddenException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { FinanceIntegrityService } from './finance-integrity.service';

function decimal(value: string) {
  return new Prisma.Decimal(value);
}

function mockPrisma() {
  return {
    studentInvoice: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
    paymentAllocation: { findMany: jest.fn() },
    walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    stationeryOrder: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
}

describe('FinanceIntegrityService', () => {
  it('restricts integrity reports to privileged finance roles', async () => {
    const service = new FinanceIntegrityService(mockPrisma());

    await expect(service.getIntegrityReport('teacher-1', [RoleName.TEACHER]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('flags invalid allocation state and succeeded payments without receipts', async () => {
    const prisma = mockPrisma();
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'BCI-2026-001',
        status: InvoiceStatus.PARTIALLY_PAID,
        lines: [{ amountDue: new Prisma.Decimal('100.00') }],
      },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'payment-1',
        status: PaymentStatus.SUCCEEDED,
        amount: new Prisma.Decimal('60.00'),
        completedAt: null,
        receipt: null,
        refunds: [],
      },
      {
        id: 'payment-2',
        status: PaymentStatus.FAILED,
        amount: new Prisma.Decimal('40.00'),
        completedAt: null,
        receipt: null,
        refunds: [],
      },
    ]);
    prisma.paymentAllocation.findMany.mockResolvedValue([
      {
        id: 'allocation-1',
        paymentId: 'payment-1',
        invoiceId: 'invoice-1',
        amount: new Prisma.Decimal('60.00'),
        payment: { id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: new Prisma.Decimal('60.00'), refunds: [] },
        invoice: { id: 'invoice-1', invoiceNumber: 'BCI-2026-001' },
      },
      {
        id: 'allocation-2',
        paymentId: 'payment-2',
        invoiceId: 'invoice-1',
        amount: new Prisma.Decimal('40.00'),
        payment: { id: 'payment-2', status: PaymentStatus.FAILED, amount: new Prisma.Decimal('40.00'), refunds: [] },
        invoice: { id: 'invoice-1', invoiceNumber: 'BCI-2026-001' },
      },
    ]);

    const service = new FinanceIntegrityService(prisma);
    const report = await service.getIntegrityReport('accountant-1', [RoleName.ACCOUNTANT]);

    expect(report.healthy).toBe(false);
    expect(report.findings.invalidStatusAllocations).toHaveLength(1);
    expect(report.findings.invalidStatusAllocations[0].paymentId).toBe('payment-2');
    expect(report.findings.succeededWithoutReceipt).toHaveLength(1);
    expect(report.findings.succeededWithoutReceipt[0].paymentId).toBe('payment-1');
    expect(report.findings.overRefundedPayments).toHaveLength(0);
  });
  it('detects a succeeded wallet top-up without a corresponding ledger credit', async () => {
    const prisma = {
      studentInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'payment-wallet-1',
            studentId: 'student-1',
            purpose: 'WALLET_TOP_UP',
            status: PaymentStatus.SUCCEEDED,
            amount: decimal('75.00'),
            completedAt: new Date(),
            receipt: { id: 'receipt-1', receiptNumber: 'R-1' },
            refunds: [],
          },
        ]),
      },
      paymentAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      stationeryOrder: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new FinanceIntegrityService(prisma as never);

    const report = await service.getIntegrityReport('accountant-user', [RoleName.ACCOUNTANT]);

    expect(report.findings.successfulWalletTopUpsWithoutLedger).toEqual([
      { paymentId: 'payment-wallet-1', studentId: 'student-1', amount: '75.00' },
    ]);
    expect(report.healthy).toBe(false);
  });

  it('detects malformed wallet effects and a negative balance', async () => {
    const prisma = {
      studentInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      paymentAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      stationeryOrder: { findMany: jest.fn().mockResolvedValue([]) },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'wallet-tx-1',
            walletId: 'student-1',
            type: 'TOP_UP',
            direction: 'DEBIT',
            amount: decimal('50.00'),
            paymentId: null,
            reversalOfId: null,
            payment: null,
            reversalOf: null,
          },
          {
            id: 'wallet-tx-2',
            walletId: 'student-1',
            type: 'WITHDRAWAL',
            direction: 'DEBIT',
            amount: decimal('75.00'),
            paymentId: null,
            reversalOfId: null,
            payment: null,
            reversalOf: null,
          },
        ]),
      },
    };
    const service = new FinanceIntegrityService(prisma as never);

    const report = await service.getIntegrityReport('accountant-user', [RoleName.ACCOUNTANT]);

    expect(report.findings.invalidWalletDirections).toHaveLength(1);
    expect(report.findings.negativeWalletBalances).toEqual([
      { studentId: 'student-1', balance: '-125.00' },
    ]);
    expect(report.healthy).toBe(false);
  });
  it('detects a successful stationery payment without a linked order', async () => {
    const prisma = {
      studentInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      payment: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'stationery-payment-1',
          studentId: 'student-1',
          purpose: 'STATIONERY',
          status: PaymentStatus.SUCCEEDED,
          amount: decimal('25.00'),
          completedAt: new Date(),
          receipt: { id: 'receipt-1', receiptNumber: 'R-1' },
          refunds: [],
        }]),
      },
      paymentAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      stationeryOrder: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new FinanceIntegrityService(prisma as never);
    const report = await service.getIntegrityReport('accountant-user', [RoleName.ACCOUNTANT]);

    expect(report.findings.successfulStationeryPaymentsWithoutOrder).toEqual([
      { paymentId: 'stationery-payment-1', studentId: 'student-1', amount: '25.00' },
    ]);
    expect(report.healthy).toBe(false);
  });

  it('detects a paid stationery order whose linked payment no longer matches', async () => {
    const prisma = {
      studentInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      payment: { findMany: jest.fn().mockResolvedValue([]) },
      paymentAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      stationeryOrder: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'order-1',
          orderNumber: 'ST-1',
          studentId: 'student-1',
          guardianId: 'guardian-1',
          status: 'PAID',
          totalAmount: decimal('25.00'),
          paymentId: 'payment-1',
          payment: {
            id: 'payment-1',
            studentId: 'student-1',
            guardianId: 'guardian-1',
            amount: decimal('25.00'),
            purpose: 'FEE',
            status: PaymentStatus.SUCCEEDED,
          },
        }]),
      },
    };
    const service = new FinanceIntegrityService(prisma as never);
    const report = await service.getIntegrityReport('accountant-user', [RoleName.ACCOUNTANT]);

    expect(report.findings.invalidStationeryPaymentLinks).toHaveLength(1);
    expect(report.healthy).toBe(false);
  });


});
