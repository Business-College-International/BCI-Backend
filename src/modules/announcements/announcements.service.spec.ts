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

  it('requires a recipient for USER announcements', async () => {
    const prisma = {} as never;
    const service = new AnnouncementsService(prisma);
    await expect(service.create({ title: 'Test', body: 'Body', audienceType: 'USER' }, 'user-1', [RoleName.OFFICE]))
      .rejects.toThrow('USER announcement requires audienceRef');
  });
});
