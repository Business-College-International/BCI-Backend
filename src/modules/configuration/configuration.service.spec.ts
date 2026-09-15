import { ConflictException } from '@nestjs/common';
import { ConfigurationService } from './configuration.service';

function makePrisma(tx: any) {
  return { $transaction: async (callback: (client: any) => unknown) => callback(tx) };
}

describe('ConfigurationService', () => {
  it('rejects subject level changes when the subject is already assigned', async () => {
    const tx = {
      subject: {
        findUnique: jest.fn().mockResolvedValue({ id: 'subject-1', name: 'Mathematics', level: 'SHS1', programme: 'NONE', isElective: false, isActive: true, assignments: [{ id: 'assignment-1' }] }),
      },
    };
    const service = new ConfigurationService(makePrisma(tx) as never);
    await expect(service.updateSubject('subject-1', { level: 'SHS2' as any }, 'actor-1', ['DIRECTOR'] as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a non-elective subject tied to a programme', async () => {
    const tx = { subject: { create: jest.fn() }, auditLog: { create: jest.fn() } };
    const service = new ConfigurationService(makePrisma(tx) as never);
    await expect(service.createSubject({ code: 'AGR1', name: 'Agriculture', level: 'SHS1' as any, programme: 'AGRIC' as any, isElective: false }, 'actor-1', ['DIRECTOR'] as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('records fee amount as decimal and rejects duplicate items from Prisma', async () => {
    const tx = {
      term: { findUnique: jest.fn() },
    };
    const prisma = {
      term: { findUnique: jest.fn().mockResolvedValue({ id: 'term-1' }) },
      $transaction: async (callback: (client: any) => unknown) => {
        const client = { feeSchedule: { create: jest.fn().mockRejectedValue({ code: 'P2002' }) }, auditLog: { create: jest.fn() } };
        return callback(client);
      },
    };
    const service = new ConfigurationService(prisma as never);
    await expect(service.createFeeSchedule({ termId: 'term-1', level: 'SHS1' as any, programme: 'BUSINESS' as any, itemCode: 'TUITION', itemName: 'Tuition', amount: 1200 }, 'actor-1', ['ACCOUNTANT'] as any)).rejects.toThrow('already exists');
  });
});
