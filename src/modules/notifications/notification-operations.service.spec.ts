import { NotificationOperationsService } from './notification-operations.service';
import { RoleName } from '@prisma/client';

describe('NotificationOperationsService', () => {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    notificationDelivery: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('rejects queue access for non-management roles', async () => {
    const service = new NotificationOperationsService(prisma);
    await expect(service.listQueue([RoleName.TEACHER])).rejects.toThrow('Notification operations access is restricted.');
  });

  it('only requeues failed deliveries', async () => {
    prisma.$transaction.mockImplementation((callback: any) => callback({
      $queryRaw: jest.fn().mockResolvedValue([]),
      notificationDelivery: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'delivered', channel: 'IN_APP', provider: 'internal' }) },
      auditLog: { create: jest.fn() },
    }));

    const service = new NotificationOperationsService(prisma);
    await expect(service.requeue('d1', 'actor-1', [RoleName.DIRECTOR])).rejects.toThrow('Only failed deliveries can be requeued.');
  });

  it('locks a failed delivery before requeueing it', async () => {
    const raw = jest.fn().mockResolvedValue([]);
    const update = jest.fn().mockResolvedValue({ id: 'd2', status: 'pending', channel: 'SMS', provider: 'moolre' });
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
        $queryRaw: raw,
        notificationDelivery: {
          findUnique: jest.fn().mockResolvedValue({ id: 'd2', status: 'failed', channel: 'SMS', provider: 'moolre' }),
          update,
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      }),
    };
    const service = new NotificationOperationsService(prisma as any);

    await service.requeue('d2', 'actor-1', [RoleName.OFFICE]);

    expect(raw).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalled();
  });

  it('requeues a failed delivery and audits the transition', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'd1', status: 'pending', channel: 'SMS', provider: 'moolre' });
    const audit = jest.fn();
    prisma.$transaction.mockImplementation((callback: any) => callback({
      notificationDelivery: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', status: 'failed', channel: 'SMS', provider: 'moolre' }), update },
      auditLog: { create: audit },
    }));

    const service = new NotificationOperationsService(prisma);
    await expect(service.requeue('d1', 'actor-1', [RoleName.OFFICE])).resolves.toEqual({ id: 'd1', status: 'pending', channel: 'SMS', provider: 'moolre' });
    expect(update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { status: 'pending', failureCode: null }, select: { id: true, status: true, channel: true, provider: true } });
    expect(audit).toHaveBeenCalled();
  });
});
