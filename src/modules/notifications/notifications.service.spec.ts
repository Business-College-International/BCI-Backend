import { ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('rejects unsupported status filters', async () => {
    const prisma = { notificationDelivery: { findMany: jest.fn() } } as any;
    const service = new NotificationsService(prisma);
    await expect(service.listMine('user-1', { status: 'hacked' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.notificationDelivery.findMany).not.toHaveBeenCalled();
  });

  it('limits notification reads to the authenticated recipient', async () => {
    const prisma = {
      notificationDelivery: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const service = new NotificationsService(prisma);
    await service.listMine('user-1', {});
    expect(prisma.notificationDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { recipientUserId: 'user-1' } }));
  });
});
