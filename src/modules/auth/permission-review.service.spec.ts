import { ForbiddenException } from '@nestjs/common';
import { PermissionReviewService } from './permission-review.service';

describe('PermissionReviewService', () => {
  it('restricts review to directors', async () => {
    const prisma = { userPermission: { findMany: jest.fn() } };
    const service = new PermissionReviewService(prisma as any);
    await expect(service.review(['OFFICE'] as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userPermission.findMany).not.toHaveBeenCalled();
  });

  it('classifies scoped and global grants without exposing user contact data', async () => {
    const prisma = {
      userPermission: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p-1', userId: 'u-1', permissionCode: 'attendance.manage', scopeType: 'CLASS', scopeId: 'c-1', grantedAt: new Date('2026-01-01'), grantedBy: 'u-admin', user: { id: 'u-1', status: 'ACTIVE', roles: [{ role: 'TEACHER' }] } },
          { id: 'p-2', userId: 'u-2', permissionCode: 'audit.read', scopeType: null, scopeId: null, grantedAt: new Date('2026-01-02'), grantedBy: 'u-admin', user: { id: 'u-2', status: 'ACTIVE', roles: [{ role: 'DIRECTOR' }] } },
        ]),
      },
    };
    const service = new PermissionReviewService(prisma as any);
    const result = await service.review(['DIRECTOR'] as any);

    expect(result[0]).toMatchObject({ grantType: 'SCOPED', globalRouteEffective: false, finding: 'SCOPED_GRANT_REQUIRES_DOMAIN_SCOPE_ENFORCEMENT' });
    expect(result[1]).toMatchObject({ grantType: 'GLOBAL', globalRouteEffective: true, finding: 'NONE' });
    expect(result[0]).not.toHaveProperty('email');
    expect(result[0]).not.toHaveProperty('phone');
  });
});
