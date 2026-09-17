import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InvoiceStatus, PaymentPurpose, PaymentStatus, Prisma, RoleName } from '@prisma/client';
import { FinanceService } from './finance.service';

function mockPrisma() {
  return {
    feeSchedule: { findMany: jest.fn(), create: jest.fn() },
    term: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    studentInvoice: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    guardian: { findUnique: jest.fn() },
    guardianStudent: { findUnique: jest.fn() },
    payment: { findMany: jest.fn() },
    $transaction: jest.fn(),
  } as any;
}

describe('FinanceService', () => {
  it('rejects a fee item that does not match the student enrolment', async () => {
    const prisma = mockPrisma();
    const tx = {
      student: { findUnique: jest.fn() },
      term: { findUnique: jest.fn() },
      feeSchedule: { findMany: jest.fn() },
      studentInvoice: { findFirst: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.student.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      enrolments: [{ level: 'SHS1', programme: 'BUSINESS' }],
    });
    tx.term.findUnique.mockResolvedValue({ status: 'OPEN' });
    tx.feeSchedule.findMany.mockResolvedValue([
      { id: 'fee-1', termId: 'term-1', level: 'SHS1', programme: 'GENERAL_ARTS', amount: 100, itemName: 'Test' },
    ]);

    const service = new FinanceService(prisma);

    await expect(service.issueInvoice({
      studentId: 'student-1',
      termId: 'term-1',
      feeScheduleIds: ['fee-1'],
    }, 'accountant-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks issuing a second open invoice for the same student and term', async () => {
    const prisma = mockPrisma();
    const tx = {
      student: { findUnique: jest.fn() },
      term: { findUnique: jest.fn() },
      feeSchedule: { findMany: jest.fn() },
      studentInvoice: { findFirst: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.student.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      enrolments: [{ level: 'SHS1', programme: 'BUSINESS' }],
    });
    tx.term.findUnique.mockResolvedValue({ status: 'OPEN' });
    tx.feeSchedule.findMany.mockResolvedValue([
      { id: 'fee-1', termId: 'term-1', level: 'SHS1', programme: 'BUSINESS', amount: 100, itemName: 'Test' },
    ]);
    tx.studentInvoice.findFirst.mockResolvedValue({ id: 'invoice-existing', status: InvoiceStatus.OPEN });

    const service = new FinanceService(prisma);

    await expect(service.issueInvoice({
      studentId: 'student-1',
      termId: 'term-1',
      feeScheduleIds: ['fee-1'],
    }, 'accountant-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('denies a guardian whose ward link cannot pay fees', async () => {
    const prisma = mockPrisma();
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-person-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canPayFees: false });

    const service = new FinanceService(prisma);

    await expect(
      service.listStudentInvoices('student-1', 'guardian-user-1', [RoleName.GUARDIAN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an accountant to access student invoices without guardian linkage', async () => {
    const prisma = mockPrisma();
    prisma.studentInvoice.findMany.mockResolvedValue([]);

    const service = new FinanceService(prisma);

    await expect(
      service.listStudentInvoices('student-1', 'accountant-user-1', [RoleName.ACCOUNTANT]),
    ).resolves.toEqual([]);
  });

  it('excludes allocations linked to non-succeeded payments from invoice balances', async () => {
    const prisma = mockPrisma();
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'BCI-2026-TEST',
        studentId: 'student-1',
        termId: 'term-1',
        status: InvoiceStatus.OPEN,
        issuedAt: new Date('2026-09-01T00:00:00.000Z'),
        dueAt: null,
        notes: null,
        lines: [{ id: 'line-1', description: 'Tuition', amountDue: new Prisma.Decimal('100.00') }],
        allocations: [
          { amount: new Prisma.Decimal('40.00'), payment: { status: PaymentStatus.SUCCEEDED, refunds: [] } },
          { amount: new Prisma.Decimal('60.00'), payment: { status: PaymentStatus.FAILED, refunds: [] } },
        ],
      },
    ]);

    const service = new FinanceService(prisma);
    const result = await service.listStudentInvoices('student-1', 'accountant-user-1', [RoleName.ACCOUNTANT]);

    expect(result[0].amountAllocated).toBe('40.00');
    expect(result[0].outstandingAmount).toBe('60.00');
  });

  it('nets successful refunds when listing student invoices', async () => {
    const prisma = mockPrisma();
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'BCI-2026-REFUND',
        studentId: 'student-1',
        termId: 'term-1',
        status: InvoiceStatus.PARTIALLY_PAID,
        issuedAt: new Date('2026-09-01T00:00:00.000Z'),
        dueAt: null,
        notes: null,
        lines: [{ id: 'line-1', description: 'Tuition', amountDue: new Prisma.Decimal('100.00') }],
        allocations: [
          {
            amount: new Prisma.Decimal('100.00'),
            payment: {
              status: PaymentStatus.REFUNDED,
              refunds: [{ amount: new Prisma.Decimal('25.00'), status: PaymentStatus.SUCCEEDED }],
            },
          },
        ],
      },
    ]);

    const service = new FinanceService(prisma);
    const result = await service.listStudentInvoices('student-1', 'accountant-user-1', [RoleName.ACCOUNTANT]);

    expect(result[0].amountAllocated).toBe('75.00');
    expect(result[0].outstandingAmount).toBe('25.00');
  });

  it('keeps refunded payment history while exposing gross, refunded, and net receipt values', async () => {
    const prisma = mockPrisma();
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'payment-1',
        amount: new Prisma.Decimal('100.00'),
        currency: 'GHS',
        purpose: PaymentPurpose.FEE,
        status: PaymentStatus.REFUNDED,
        completedAt: new Date('2026-09-05T00:00:00.000Z'),
        provider: 'MOOLRE',
        providerReference: 'moolre-ref-1',
        receipt: null,
        refunds: [{ amount: new Prisma.Decimal('25.00'), status: PaymentStatus.SUCCEEDED }],
        allocations: [{ invoiceId: 'invoice-1', invoice: { invoiceNumber: 'INV-001', termId: 'term-1' }, amount: new Prisma.Decimal('100.00') }],
      },
    ]);

    const service = new FinanceService(prisma);
    const result = await service.listStudentReceipts('student-1', 'accountant-user-1', [RoleName.ACCOUNTANT]);

    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: 'student-1', status: { in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] } },
    }));
    expect(result[0]).toMatchObject({
      amount: '100.00',
      originalAmount: '100.00',
      refundedAmount: '25.00',
      netAmount: '75.00',
      status: PaymentStatus.REFUNDED,
    });
  });

  it('reports net collection, refund totals, and outstanding balances in the finance summary', async () => {
    const prisma = mockPrisma();
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        status: InvoiceStatus.PARTIALLY_PAID,
        lines: [{ amountDue: new Prisma.Decimal('100.00') }],
        allocations: [
          {
            amount: new Prisma.Decimal('100.00'),
            payment: {
              status: PaymentStatus.REFUNDED,
              refunds: [{ amount: new Prisma.Decimal('25.00'), status: PaymentStatus.SUCCEEDED }],
            },
          },
        ],
      },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      {
        status: PaymentStatus.REFUNDED,
        amount: new Prisma.Decimal('100.00'),
        refunds: [{ amount: new Prisma.Decimal('25.00'), status: PaymentStatus.SUCCEEDED }],
      },
    ]);

    const service = new FinanceService(prisma);
    const result = await service.getFinanceSummary({}, 'accountant-user-1', [RoleName.ACCOUNTANT]);

    expect(result.invoices).toMatchObject({
      invoicedAmount: '100.00',
      allocatedAmount: '75.00',
      outstandingAmount: '25.00',
    });
    expect(result.payments).toMatchObject({
      collectedAmount: '75.00',
      refundedAmount: '25.00',
      pendingAmount: '0.00',
      totalPaymentRecords: 1,
    });
  });
});
