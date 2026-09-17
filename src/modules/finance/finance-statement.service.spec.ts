import { Prisma } from '@prisma/client';
import { FinanceStatementService } from './finance-statement.service';

describe('FinanceStatementService', () => {
  it('counts only successful fee allocations and payments in the statement totals', async () => {
    const prisma = {
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1',
          admissionNumber: 'BCI-001',
          firstName: 'Ama',
          lastName: 'Mensah',
          guardians: [{ guardian: { userId: 'guardian-user' }, canPayFees: true }],
        }),
      },
      studentInvoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'invoice-1',
            invoiceNumber: 'INV-001',
            status: 'PARTIALLY_PAID',
            issuedAt: new Date('2026-09-01'),
            dueAt: null,
            notes: null,
            term: { id: 'term-1', code: 'T1', name: 'First Term', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-01') },
            lines: [{ id: 'line-1', description: 'Tuition', amountDue: new Prisma.Decimal('1000.00') }],
            allocations: [{
              amount: new Prisma.Decimal('300.00'),
              payment: {
                id: 'payment-1',
                status: 'SUCCEEDED',
                completedAt: new Date('2026-09-05'),
                receipt: null,
                refunds: [],
              },
            }],
          },
        ]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'payment-1',
            amount: new Prisma.Decimal('300.00'),
            currency: 'GHS',
            purpose: 'FEE',
            status: 'SUCCEEDED',
            completedAt: new Date('2026-09-05'),
            receipt: null,
            refunds: [],
            allocations: [{ invoice: { invoiceNumber: 'INV-001' }, amount: new Prisma.Decimal('300.00') }],
          },
        ]),
      },
    } as any;

    const service = new FinanceStatementService(prisma);
    const statement = await service.getStudentStatement('student-1', 'guardian-user', ['GUARDIAN'] as any);

    expect(statement.summary).toEqual({ totalDue: '1000.00', totalPaid: '300.00', totalOutstanding: '700.00' });
    expect(statement.invoices[0].paid).toBe('300.00');
    expect(statement.invoices[0].allocations[0]).toMatchObject({
      amount: '300.00',
      originalAmount: '300.00',
      refundedAmount: '0.00',
    });
    expect(statement.receipts[0]).toMatchObject({
      amount: '300.00',
      originalAmount: '300.00',
      refundedAmount: '0.00',
      netAmount: '300.00',
    });
    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: 'student-1', status: { in: ['SUCCEEDED', 'REFUNDED'] }, purpose: 'FEE' },
    }));
    expect(prisma.studentInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { studentId: 'student-1' },
    }));
  });

  it('reduces statement balances and preserves receipt history after a partial refund', async () => {
    const prisma = {
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1',
          admissionNumber: 'BCI-001',
          firstName: 'Ama',
          lastName: 'Mensah',
          guardians: [{ guardian: { userId: 'guardian-user' }, canPayFees: true }],
        }),
      },
      studentInvoice: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'invoice-1',
            invoiceNumber: 'INV-001',
            status: 'PARTIALLY_PAID',
            issuedAt: new Date('2026-09-01'),
            dueAt: null,
            notes: null,
            term: { id: 'term-1', code: 'T1', name: 'First Term', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-12-01') },
            lines: [{ id: 'line-1', description: 'Tuition', amountDue: new Prisma.Decimal('100.00') }],
            allocations: [{
              amount: new Prisma.Decimal('100.00'),
              payment: {
                id: 'payment-1',
                status: 'REFUNDED',
                completedAt: new Date('2026-09-05'),
                receipt: null,
                refunds: [{ amount: new Prisma.Decimal('25.00'), status: 'SUCCEEDED' }],
              },
            }],
          },
        ]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'payment-1',
            amount: new Prisma.Decimal('100.00'),
            currency: 'GHS',
            purpose: 'FEE',
            status: 'REFUNDED',
            completedAt: new Date('2026-09-05'),
            receipt: null,
            refunds: [{ amount: new Prisma.Decimal('25.00'), status: 'SUCCEEDED' }],
            allocations: [{ invoice: { invoiceNumber: 'INV-001' }, amount: new Prisma.Decimal('100.00') }],
          },
        ]),
      },
    } as any;

    const service = new FinanceStatementService(prisma);
    const statement = await service.getStudentStatement('student-1', 'guardian-user', ['GUARDIAN'] as any);

    expect(statement.summary).toEqual({ totalDue: '100.00', totalPaid: '75.00', totalOutstanding: '25.00' });
    expect(statement.invoices[0].allocations[0]).toMatchObject({
      amount: '75.00',
      originalAmount: '100.00',
      refundedAmount: '25.00',
    });
    expect(statement.receipts[0]).toMatchObject({
      amount: '100.00',
      originalAmount: '100.00',
      refundedAmount: '25.00',
      netAmount: '75.00',
    });
  });

  it('denies a guardian without fee permission', async () => {
    const prisma = {
      student: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'student-1', admissionNumber: 'BCI-001', firstName: 'Ama', lastName: 'Mensah',
          guardians: [{ guardian: { userId: 'guardian-user' }, canPayFees: false }],
        }),
      },
    } as any;

    const service = new FinanceStatementService(prisma);
    await expect(service.getStudentStatement('student-1', 'guardian-user', ['GUARDIAN'] as any)).rejects.toThrow(
      'This guardian is not permitted to view or pay fees for this ward.',
    );
  });
});
