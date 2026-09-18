import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { AnnouncementsService } from './announcements.service';

describe('AnnouncementsService', () => {
  it('rejects creation for non-manager roles', async () => {
    const prisma = {} as never;
    const service = new AnnouncementsService(prisma);
    await expect(service.create({ title: 'Test', body: 'Body', audienceType: 'ALL' }, 'user-1', [RoleName.TEACHER]))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('locks the announcement before publishing and creating deliveries', async () => {
    const raw = jest.fn().mockResolvedValue([]);
    const update = jest.fn().mockResolvedValue({ id: 'a2', publishedAt: new Date('2026-09-18T18:30:00Z') });
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const audit = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: raw,
      announcement: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'a2',
          title: 'Term notice',
          body: 'Please note.',
          audienceType: 'ALL',
          audienceRef: null,
          publishedAt: null,
        }),
        update,
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]) },
      notificationDelivery: { createMany },
      auditLog: { create: audit },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AnnouncementsService(prisma as never);

    const result = await service.publish('a2', 'actor-1', [RoleName.OFFICE]);

    expect(result.recipientCount).toBe(1);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'a2' },
      data: { publishedAt: expect.any(Date) },
    });
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it('requires a recipient for USER announcements', async () => {
    const prisma = {} as never;
    const service = new AnnouncementsService(prisma);
    await expect(service.create({ title: 'Test', body: 'Body', audienceType: 'USER' }, 'user-1', [RoleName.OFFICE]))
      .rejects.toThrow('USER announcement requires audienceRef');
  });
});
