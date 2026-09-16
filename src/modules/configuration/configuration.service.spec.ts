import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigurationService } from './configuration.service';

function makePrisma(tx: any) {
  return { $transaction: async (callback: (client: any) => unknown) => callback(tx) };
}

describe('ConfigurationService', () => {
  it('rejects subject level changes when the subject is already assigned', async () => {
    const prisma = { subject: { findUnique: jest.fn().mockResolvedValue({ id: 'subject-1', name: 'Mathematics', level: 'SHS1', programme: 'NONE', isElective: false, isActive: true, assignments: [{ id: 'assignment-1' }] }) } };
    const service = new ConfigurationService(prisma as never);
    await expect(service.updateSubject('subject-1', { level: 'SHS2' as any }, 'actor-1', ['DIRECTOR'] as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a non-elective subject tied to a programme', async () => {
    const tx = { subject: { create: jest.fn() }, auditLog: { create: jest.fn() } };
    const service = new ConfigurationService(makePrisma(tx) as never);
    await expect(service.createSubject({ code: 'AGR1', name: 'Agriculture', level: 'SHS1' as any, programme: 'AGRIC' as any, isElective: false }, 'actor-1', ['DIRECTOR'] as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects duplicate fee items from Prisma', async () => {
    const prisma = {
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', status: 'OPEN' }) },
      $transaction: async (callback: (client: any) => unknown) => callback({ feeSchedule: { create: jest.fn().mockRejectedValue({ code: 'P2002' }) }, auditLog: { create: jest.fn() } }),
    };
    const service = new ConfigurationService(prisma as never);
    await expect(service.createFeeSchedule({ termId: 'term-1', level: 'SHS1' as any, programme: 'BUSINESS' as any, itemCode: 'TUITION', itemName: 'Tuition', amount: 1200 }, 'actor-1', ['ACCOUNTANT'] as any)).rejects.toThrow('already exists');
  });

  it('blocks adding fee items to a closed term', async () => {
    const prisma = { term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1', status: 'CLOSED' }) } };
    const service = new ConfigurationService(prisma as never);
    await expect(service.createFeeSchedule({ termId: 'term-1', level: 'SHS1' as any, programme: 'BUSINESS' as any, itemCode: 'TUITION', itemName: 'Tuition', amount: 1200 }, 'actor-1', ['ACCOUNTANT'] as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks fee amount changes after the item has been used on an invoice', async () => {
    const prisma = { feeSchedule: { findUnique: jest.fn().mockResolvedValue({ id: 'fee-1', termId: 'term-1', itemName: 'Tuition', amount: new Prisma.Decimal('1200.00'), isOptional: false, isActive: true, charges: [{ id: 'line-1' }] }) } };
    const service = new ConfigurationService(prisma as never);
    await expect(service.updateFeeSchedule('fee-1', { amount: 1300 }, 'actor-1', ['ACCOUNTANT'] as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows audited non-monetary fee edits', async () => {
    const tx = {
      feeSchedule: { update: jest.fn().mockResolvedValue({ id: 'fee-1', itemName: 'Tuition and ICT', amount: new Prisma.Decimal('1200.00'), isOptional: true, isActive: false }) },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      feeSchedule: { findUnique: jest.fn().mockResolvedValue({ id: 'fee-1', termId: 'term-1', itemName: 'Tuition', amount: new Prisma.Decimal('1200.00'), isOptional: false, isActive: true, charges: [{ id: 'line-1' }] }) },
      term: { findUnique: jest.fn().mockResolvedValue({ status: 'OPEN' }) },
      $transaction: async (callback: (client: any) => unknown) => callback(tx),
    };
    const service = new ConfigurationService(prisma as never);
    const result = await service.updateFeeSchedule('fee-1', { itemName: 'Tuition and ICT', isOptional: true, isActive: false }, 'actor-1', ['ACCOUNTANT'] as any);
    expect(result.id).toBe('fee-1');
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
});