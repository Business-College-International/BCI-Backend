import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, RoleName } from '@prisma/client';
import { FinanceReceivablesService } from './finance-receivables.service';

function makePrisma() {
  return {
    studentInvoice: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('FinanceReceivablesService', () => {
  it('refuses to void an invoice that already has allocations', async () => {
    const prisma = makePrisma();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
    prisma.studentInvoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      status: InvoiceStatus.PARTIALLY_PAID,
      allocations: [{ amount: '100.00' }],
    });

    const service = new FinanceReceivablesService(prisma as never);

    await expect(
      service.voidInvoice('invoice-1', { reason: 'Duplicate issuance' }, 'office-1', [RoleName.OFFICE]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.studentInvoice.update).not.toHaveBeenCalled();
  });

  it('builds ageing buckets from successful payment allocations only', async () => {
    const prisma = makePrisma();
    const asOf = new Date('2026-09-15T00:00:00.000Z');
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1', invoiceNumber: 'BCI-1', dueAt: new Date('2026-09-10T00:00:00.000Z'),
        lines: [{ amountDue: '500.00' }],
        allocations: [
          { amount: '100.00', payment: { status: PaymentStatus.SUCCEEDED } },
          { amount: '100.00', payment: { status: PaymentStatus.PROCESSING } },
        ],
        student: { id: 'student-1', admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Doe' },
      },
      {
        id: 'invoice-2', invoiceNumber: 'BCI-2', dueAt: new Date('2026-07-01T00:00:00.000Z'),
        lines: [{ amountDue: '1000.00' }], allocations: [],
        student: { id: 'student-2', admissionNumber: 'BCI-002', firstName: 'Kojo', lastName: 'Doe' },
      },
    ]);

    const service = new FinanceReceivablesService(prisma as never);
    const result = await service.ageing('accountant-1', [RoleName.ACCOUNTANT], asOf);

    expect(result.totals.days1to30).toBe('400.00');
    expect(result.totals.days61to90).toBe('1000.00');
    expect(result.totals.outstanding).toBe('1400.00');
    expect(result.rows).toHaveLength(2);
  });
});
