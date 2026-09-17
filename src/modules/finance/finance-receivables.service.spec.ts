import { BadRequestException, ConflictException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { FinanceReceivablesService } from './finance-receivables.service';

function makePrisma() {
  return {
    studentInvoice: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
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
      allocations: [{ amount: new Prisma.Decimal('100.00') }],
    });

    const service = new FinanceReceivablesService(prisma as never);

    await expect(
      service.voidInvoice('invoice-1', { reason: 'Duplicate issuance' }, 'office-1', [RoleName.OFFICE]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.studentInvoice.updateMany).not.toHaveBeenCalled();
  });

  it('uses a conditional serializable transition when voiding an unallocated invoice', async () => {
    const prisma = makePrisma();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown, options: unknown) => {
      expect(options).toEqual(expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
      return callback(prisma);
    });
    prisma.studentInvoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      status: InvoiceStatus.OPEN,
      allocations: [],
    });
    prisma.studentInvoice.updateMany.mockResolvedValue({ count: 1 });

    const service = new FinanceReceivablesService(prisma as never);
    const result = await service.voidInvoice('invoice-1', { reason: 'Duplicate issuance' }, 'office-1', [RoleName.OFFICE]);

    expect(result).toEqual({ success: true, invoiceId: 'invoice-1', status: InvoiceStatus.VOID });
    expect(prisma.studentInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invoice-1', status: InvoiceStatus.OPEN, allocations: { none: {} } },
    }));
  });

  it('rejects a lost conditional void transition as a concurrency conflict', async () => {
    const prisma = makePrisma();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
    prisma.studentInvoice.findUnique.mockResolvedValue({ id: 'invoice-1', status: InvoiceStatus.OPEN, allocations: [] });
    prisma.studentInvoice.updateMany.mockResolvedValue({ count: 0 });

    const service = new FinanceReceivablesService(prisma as never);
    await expect(
      service.voidInvoice('invoice-1', { reason: 'Duplicate issuance' }, 'office-1', [RoleName.OFFICE]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('translates a serialization conflict into a retryable conflict response', async () => {
    const prisma = makePrisma();
    prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    const service = new FinanceReceivablesService(prisma as never);
    await expect(
      service.voidInvoice('invoice-1', { reason: 'Duplicate issuance' }, 'office-1', [RoleName.OFFICE]),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('builds ageing buckets from settled invoice balances and ignores processing allocations', async () => {
    const prisma = makePrisma();
    const asOf = new Date('2026-09-15T00:00:00.000Z');
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1', invoiceNumber: 'BCI-1', dueAt: new Date('2026-09-10T00:00:00.000Z'),
        lines: [{ amountDue: new Prisma.Decimal('500.00') }],
        allocations: [
          { amount: new Prisma.Decimal('200.00'), payment: { status: PaymentStatus.PROCESSING, refunds: [] } },
          { amount: new Prisma.Decimal('200.00'), payment: { status: PaymentStatus.SUCCEEDED, refunds: [{ amount: new Prisma.Decimal('100.00'), status: PaymentStatus.SUCCEEDED }] } },
        ],
        student: { id: 'student-1', admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Doe' },
      },
      {
        id: 'invoice-2', invoiceNumber: 'BCI-2', dueAt: new Date('2026-07-01T00:00:00.000Z'),
        lines: [{ amountDue: new Prisma.Decimal('1000.00') }],
        allocations: [],
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

  it('ignores processing allocations in invoice settlement reporting', async () => {
    const prisma = makePrisma();
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'BCI-1',
        status: InvoiceStatus.OPEN,
        issuedAt: new Date('2026-09-01T00:00:00.000Z'),
        dueAt: null,
        lines: [{ amountDue: new Prisma.Decimal('200.00') }],
        allocations: [
          { amount: new Prisma.Decimal('100.00'), payment: { status: PaymentStatus.PROCESSING, refunds: [] } },
          { amount: new Prisma.Decimal('100.00'), payment: { status: PaymentStatus.SUCCEEDED, refunds: [] } },
        ],
        student: { admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Doe' },
        term: { id: 'term-1', code: 'T1', name: 'Term 1' },
      },
    ]);

    const service = new FinanceReceivablesService(prisma as never);
    const result = await service.listInvoices({}, 'accountant-1', [RoleName.ACCOUNTANT]);

    expect(result[0].allocatedAmount).toBe('100.00');
    expect(result[0].outstandingAmount).toBe('100.00');
  });

  it('reports a refunded payment as reducing the invoice allocated balance', async () => {
    const prisma = makePrisma();
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'BCI-1',
        status: InvoiceStatus.PAID,
        issuedAt: new Date('2026-09-01T00:00:00.000Z'),
        dueAt: null,
        lines: [{ amountDue: new Prisma.Decimal('100.00') }],
        allocations: [{ amount: new Prisma.Decimal('100.00'), payment: { status: PaymentStatus.REFUNDED, refunds: [{ amount: new Prisma.Decimal('25.00'), status: PaymentStatus.SUCCEEDED }] } }],
        student: { admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Doe' },
        term: { id: 'term-1', code: 'T1', name: 'Term 1' },
      },
    ]);

    const service = new FinanceReceivablesService(prisma as never);
    const result = await service.listInvoices({}, 'accountant-1', [RoleName.ACCOUNTANT]);

    expect(result[0].allocatedAmount).toBe('75.00');
    expect(result[0].outstandingAmount).toBe('25.00');
  });
});
