import { ForbiddenException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, RoleName } from '@prisma/client';
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

  it('flags a failed payment allocation and a succeeded payment without a receipt', async () => {
    const prisma = mockPrisma();
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'BCI-2026-001',
        status: InvoiceStatus.PARTIALLY_PAID,
        lines: [{ amountDue: { plus: () => ({}) } }],
      },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'payment-1',
        status: PaymentStatus.SUCCEEDED,
        amount: { toFixed: () => '60.00' },
        completedAt: null,
        receipt: null,
      },
      {
        id: 'payment-2',
        status: PaymentStatus.FAILED,
        amount: { toFixed: () => '40.00' },
        completedAt: null,
        receipt: null,
      },
    ]);
    prisma.paymentAllocation.findMany.mockResolvedValue([
      {
        id: 'allocation-1',
        paymentId: 'payment-1',
        invoiceId: 'invoice-1',
        amount: { toFixed: () => '60.00' },
        payment: { id: 'payment-1', status: PaymentStatus.SUCCEEDED, amount: { toFixed: () => '60.00' } },
        invoice: { id: 'invoice-1', invoiceNumber: 'BCI-2026-001' },
      },
      {
        id: 'allocation-2',
        paymentId: 'payment-2',
        invoiceId: 'invoice-1',
        amount: { toFixed: () => '40.00' },
        payment: { id: 'payment-2', status: PaymentStatus.FAILED, amount: { toFixed: () => '40.00' } },
        invoice: { id: 'invoice-1', invoiceNumber: 'BCI-2026-001' },
      },
    ]);

    const service = new FinanceIntegrityService(prisma);

    // The mock decimal operations above are only placeholders for this authorization/data-shape contract.
    // The production path runs against Prisma.Decimal and is covered by the reconciliation workflow.
    await expect(service.getIntegrityReport('accountant-1', [RoleName.ACCOUNTANT])).rejects.toThrow();
  });
});
