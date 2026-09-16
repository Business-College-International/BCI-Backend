import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, RoleName } from '@prisma/client';
import { FinanceService } from './finance.service';

function mockPrisma() {
  return {
    feeSchedule: { findMany: jest.fn(), create: jest.fn() },
    term: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    studentInvoice: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    guardian: { findUnique: jest.fn() },
    guardianStudent: { findUnique: jest.fn() },
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
        lines: [{ id: 'line-1', description: 'Tuition', amountDue: { toString: () => '100.00', toFixed: () => '100.00' } }],
        allocations: [
          { amount: { toString: () => '40.00', toFixed: () => '40.00' }, payment: { status: PaymentStatus.SUCCEEDED } },
          { amount: { toString: () => '60.00', toFixed: () => '60.00' }, payment: { status: PaymentStatus.FAILED } },
        ],
      },
    ]);

    const service = new FinanceService(prisma);
    const result = await service.listStudentInvoices('student-1', 'accountant-user-1', [RoleName.ACCOUNTANT]);

    expect(result[0].amountAllocated).toBe('40.00');
    expect(result[0].outstandingAmount).toBe('60.00');
  });
});
