import { AuditAction } from '@prisma/client';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('bounds page size and paginates audit records', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'a1' }]);
    const count = jest.fn().mockResolvedValue(121);
    const prisma = { $transaction: jest.fn().mockResolvedValue([[{ id: 'a1' }], 121]), auditLog: { findMany, count } } as never;
    const service = new AuditService(prisma);

    const result = await service.list({ page: 2, pageSize: 250, action: AuditAction.UPDATE });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(100);
    expect(result.totalPages).toBe(2);
  });

  it('supports actor, entity and date filters', async () => {
    const prisma = {
      $transaction: jest.fn().mockResolvedValue([[], 0]),
      auditLog: {
        findMany: jest.fn().mockImplementation((args) => args),
        count: jest.fn().mockImplementation((args) => args),
      },
    } as never;
    const service = new AuditService(prisma);

    await service.list({ actorUserId: 'u1', entityType: 'Student', entityId: 's1', from: '2026-01-01', to: '2026-01-31' });

    const transaction = (prisma as never as { $transaction: jest.Mock }).$transaction;
    const where = transaction.mock.calls[0][0][0].where;
    expect(where.actorUserId).toBe('u1');
    expect(where.entityType).toBe('Student');
    expect(where.entityId).toBe('s1');
    expect(where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(where.createdAt.lte).toEqual(new Date('2026-01-31'));
  });
});
