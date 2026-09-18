import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FinanceBillingRunService } from './finance-billing-run.service';

function prismaStub(context: any) {
  return {
    term: { findUnique: jest.fn().mockResolvedValue(context.term) },
    enrolment: { findMany: jest.fn().mockResolvedValue(context.enrolments) },
    feeSchedule: { findMany: jest.fn().mockResolvedValue(context.schedules) },
    studentInvoice: { findMany: jest.fn().mockResolvedValue(context.openInvoices ?? []) },
  };
}

describe('FinanceBillingRunService', () => {
  const term = { id: 'term-1', code: 'T1', name: 'Term 1', status: 'OPEN' };

  it('previews only matching non-optional schedules by default', async () => {
    const service = new FinanceBillingRunService(prismaStub({
      term,
      enrolments: [{ student: { id: 'student-1', admissionNumber: 'BCI-1', firstName: 'Ama', lastName: 'Mensah', status: 'ACTIVE' }, class: { id: 'class-1', name: 'BUSINESS A' }, level: 'SHS1', programme: 'BUSINESS' }],
      schedules: [
        { id: 'fee-1', level: 'SHS1', programme: 'BUSINESS', amount: '1200.00', isOptional: false },
        { id: 'fee-2', level: 'SHS1', programme: 'BUSINESS', amount: '200.00', isOptional: true },
        { id: 'fee-3', level: 'SHS1', programme: 'AGRIC', amount: '999.00', isOptional: false },
      ],
    }) as never);

    const result = await service.preview({ termId: 'term-1' }, ['ACCOUNTANT'] as any);
    expect(result.readyCount).toBe(1);
    expect(result.candidates[0].feeScheduleIds).toEqual(['fee-1']);
    expect(result.estimatedInvoicedAmount).toBe('1200.00');
  });

  it('includes optional charges only when explicitly requested', async () => {
    const service = new FinanceBillingRunService(prismaStub({
      term,
      enrolments: [{ student: { id: 'student-1', admissionNumber: null, firstName: 'Kojo', lastName: 'Doe', status: 'ACTIVE' }, class: { id: 'class-1', name: 'SHS1 A' }, level: 'SHS1', programme: 'NONE' }],
      schedules: [
        { id: 'fee-1', level: 'SHS1', programme: 'NONE', amount: '100.00', isOptional: false },
        { id: 'fee-2', level: 'SHS1', programme: 'NONE', amount: '25.50', isOptional: true },
      ],
    }) as never);

    const result = await service.preview({ termId: 'term-1', includeOptional: true }, ['DIRECTOR'] as any);
    expect(result.candidates[0].feeScheduleIds).toEqual(['fee-1', 'fee-2']);
    expect(result.estimatedInvoicedAmount).toBe('125.50');
  });

  it('marks an existing open invoice as a preview skip', async () => {
    const service = new FinanceBillingRunService(prismaStub({
      term,
      enrolments: [{ student: { id: 'student-1', admissionNumber: 'BCI-1', firstName: 'Ama', lastName: 'Mensah', status: 'ACTIVE' }, class: { id: 'class-1', name: 'BUSINESS A' }, level: 'SHS1', programme: 'BUSINESS' }],
      schedules: [{ id: 'fee-1', level: 'SHS1', programme: 'BUSINESS', amount: '1200.00', isOptional: false }],
      openInvoices: [{ studentId: 'student-1' }],
    }) as never);

    const result = await service.preview({ termId: 'term-1' }, ['ACCOUNTANT'] as any);
    expect(result.readyCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.candidates[0].reason).toBe('EXISTING_OPEN_INVOICE');
  });

  it('rejects billing for a closed term', async () => {
    const service = new FinanceBillingRunService(prismaStub({ term: { ...term, status: 'CLOSED' }, enrolments: [], schedules: [] }) as never);
    await expect(service.preview({ termId: 'term-1' }, ['ACCOUNTANT'] as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-finance billing roles', async () => {
    const service = new FinanceBillingRunService(prismaStub({ term, enrolments: [], schedules: [] }) as never);
    await expect(service.preview({ termId: 'term-1' }, ['TEACHER'] as any)).rejects.toBeInstanceOf(ForbiddenException);
  });  it('locks each student row before issuing a billing invoice', async () => {
    const context = {
      term,
      enrolments: [{
        student: { id: 'student-1', admissionNumber: 'BCI-1', firstName: 'Ama', lastName: 'Mensah', status: 'ACTIVE' },
        class: { id: 'class-1', name: 'BUSINESS A' },
        level: 'SHS1',
        programme: 'BUSINESS',
      }],
      schedules: [{ id: 'fee-1', level: 'SHS1', programme: 'BUSINESS', amount: new Prisma.Decimal('1200.00'), isOptional: false }],
      openInvoices: [],
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue([]),
      studentInvoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'invoice-1',
          invoiceNumber: 'BCI-2026-TEST',
          studentId: 'student-1',
          lines: [{ amountDue: new Prisma.Decimal('1200.00') }],
        }),
      },
      feeSchedule: { findMany: jest.fn().mockResolvedValue(context.schedules) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = prismaStub(context) as any;
    prisma.$transaction = jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx));
    prisma.term.findUnique.mockResolvedValue(term);
    prisma.enrolment.findMany.mockResolvedValue(context.enrolments);
    prisma.feeSchedule.findMany.mockResolvedValue(context.schedules);
    prisma.studentInvoice.findMany.mockResolvedValue([]);

    const service = new FinanceBillingRunService(prisma);
    const result = await service.execute({ termId: 'term-1' }, 'actor-1', ['ACCOUNTANT'] as any);

    expect(result.issuedCount).toBe(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });


});
