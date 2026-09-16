import { AnnouncementOperationsService } from './announcement-operations.service';

describe('AnnouncementOperationsService', () => {
  const prisma = {
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    announcement: { findUnique: jest.fn() },
    notificationDelivery: { groupBy: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('previews active guardian recipients and preferences', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'u1' }, { id: 'u2' }])
      .mockResolvedValueOnce([
        { id: 'u1', guardian: { preferredSms: true, preferredPush: true } },
        { id: 'u2', guardian: { preferredSms: false, preferredPush: true } },
      ]);

    const service = new AnnouncementOperationsService(prisma);
    await expect(service.previewAudience('GUARDIANS')).resolves.toEqual({
      audienceType: 'GUARDIANS', audienceRef: null, recipientCount: 2, smsEligibleCount: 1, pushEligibleCount: 2,
    });
  });

  it('reports delivery grouped by channel and status', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 'Term notice', publishedAt: new Date() });
    prisma.notificationDelivery.groupBy.mockResolvedValue([
      { channel: 'IN_APP', status: 'delivered', _count: { _all: 20 } },
      { channel: 'SMS', status: 'failed', _count: { _all: 3 } },
    ]);

    const service = new AnnouncementOperationsService(prisma);
    await expect(service.getDeliveryReport('a1')).resolves.toMatchObject({
      announcement: { id: 'a1', title: 'Term notice' },
      deliveries: [
        { channel: 'IN_APP', status: 'delivered', count: 20 },
        { channel: 'SMS', status: 'failed', count: 3 },
      ],
    });
  });
});
