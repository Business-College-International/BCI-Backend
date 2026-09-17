import { ForbiddenException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { FinanceIntegrityService } from './finance-integrity.service';

function mockPrisma() {
  return {
    studentInvoice: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
    paymentAllocation: { findMany: jest.fn() },
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
});
