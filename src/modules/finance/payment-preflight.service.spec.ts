import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentPreflightService } from './payment-preflight.service';

function makePrisma() {
  return {
    guardian: { findUnique: jest.fn() },
    guardianStudent: { findUnique: jest.fn() },
    student: { findUnique: jest.fn() },
    studentInvoice: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
  };
}

describe('PaymentPreflightService', () => {
  it('rejects duplicate invoice ids', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canPayFees: true });
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.studentInvoice.findMany.mockResolvedValue([]);
    const service = new PaymentPreflightService(prisma as never);

    await expect(
      service.preflight(
        'student-1',
        { invoiceIds: ['invoice-1', 'invoice-1'] },
        'guardian-user',
        ['GUARDIAN'] as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects guardians without fee permission', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canPayFees: false });
    const service = new PaymentPreflightService(prisma as never);

    await expect(
      service.preflight(
        'student-1',
        { invoiceIds: ['invoice-1'] },
        'guardian-user',
        ['GUARDIAN'] as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('builds oldest-due-first allocation from settled balances and reports pending payments', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canPayFees: true });
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'BCI-1',
        studentId: 'student-1',
        termId: 'term-1',
        dueAt: new Date('2026-09-10T00:00:00Z'),
        issuedAt: new Date('2026-09-01T00:00:00Z'),
        lines: [{ amountDue: new Prisma.Decimal('500.00') }],
        allocations: [{ amount: new Prisma.Decimal('200.00'), payment: { status: 'SUCCEEDED', refunds: [{ amount: new Prisma.Decimal('100.00'), status: 'SUCCEEDED' }] } }],
        term: { id: 'term-1', code: 'T1', name: 'Term 1' },
      },
      {
        id: 'invoice-2',
        invoiceNumber: 'BCI-2',
        studentId: 'student-1',
        termId: 'term-1',
        dueAt: new Date('2026-10-01T00:00:00Z'),
        issuedAt: new Date('2026-09-02T00:00:00Z'),
        lines: [{ amountDue: new Prisma.Decimal('800.00') }],
        allocations: [],
        term: { id: 'term-1', code: 'T1', name: 'Term 1' },
      },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'payment-1',
        amount: new Prisma.Decimal('100.00'),
        status: 'PROCESSING',
        createdAt: new Date('2026-09-15T08:00:00Z'),
        clientReference: 'BCI-PENDING-1',
      },
    ]);

    const service = new PaymentPreflightService(prisma as never);
    const result = await service.preflight(
      'student-1',
      { invoiceIds: ['invoice-1', 'invoice-2'], amount: '900.00' },
      'guardian-user',
      ['GUARDIAN'] as never,
    );

    expect(result.allocations).toEqual([
      { invoiceId: 'invoice-1', invoiceNumber: 'BCI-1', termId: 'term-1', amount: '400.00' },
      { invoiceId: 'invoice-2', invoiceNumber: 'BCI-2', termId: 'term-1', amount: '500.00' },
    ]);
    expect(result.pendingPayments.amount).toBe('100.00');
    expect(result.reservation.available).toBe(true);
  });

  it('does not subtract unsettled processing allocations from invoice availability', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue({ personId: 'guardian-1' });
    prisma.guardianStudent.findUnique.mockResolvedValue({ canPayFees: true });
    prisma.student.findUnique.mockResolvedValue({ id: 'student-1' });
    prisma.studentInvoice.findMany.mockResolvedValue([
      {
        id: 'invoice-1',
        invoiceNumber: 'BCI-1',
        studentId: 'student-1',
        termId: 'term-1',
        dueAt: new Date('2026-09-10T00:00:00Z'),
        issuedAt: new Date('2026-09-01T00:00:00Z'),
        lines: [{ amountDue: new Prisma.Decimal('500.00') }],
        allocations: [
          { amount: new Prisma.Decimal('200.00'), payment: { status: 'PROCESSING', refunds: [] } },
        ],
        term: { id: 'term-1', code: 'T1', name: 'Term 1' },
      },
    ]);
    prisma.payment.findMany.mockResolvedValue([]);

    const service = new PaymentPreflightService(prisma as never);
    const result = await service.preflight(
      'student-1',
      { invoiceIds: ['invoice-1'] },
      'guardian-user',
      ['GUARDIAN'] as never,
    );

    expect(result.selectedOutstandingAmount).toBe('500.00');
    expect(result.allocations).toEqual([
      { invoiceId: 'invoice-1', invoiceNumber: 'BCI-1', termId: 'term-1', amount: '500.00' },
    ]);
  });
});
