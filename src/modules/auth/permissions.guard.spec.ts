import { ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';

function makeContext(userId = 'user-1') {
  const handler = jest.fn();
  const classRef = jest.fn();
  const request = { user: { id: userId } };
  return {
    context: {
      getHandler: () => handler,
      getClass: () => classRef,
      switchToHttp: () => ({ getRequest: () => request }),
    } as any,
    handler,
    classRef,
  };
}

describe('PermissionsGuard', () => {
  it('does not treat a scoped direct permission as a global permission', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['attendance.manage']) };
    const prisma = {
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      userPermission: {
        findMany: jest.fn().mockResolvedValue([
          { permissionCode: 'attendance.manage', scopeType: 'CLASS', scopeId: 'class-1' },
        ]),
      },
      rolePermission: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const guard = new PermissionsGuard(reflector as any, prisma as any);
    const { context } = makeContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userPermission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ scopeType: null, scopeId: null }),
    }));
  });

  it('allows an unscoped direct permission', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['attendance.manage']) };
    const prisma = {
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      userPermission: { findMany: jest.fn().mockResolvedValue([{ permissionCode: 'attendance.manage' }]) },
      rolePermission: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const guard = new PermissionsGuard(reflector as any, prisma as any);
    const { context } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows a role-level permission regardless of direct permission scope records', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['students.read']) };
    const prisma = {
      userRole: { findMany: jest.fn().mockResolvedValue([{ role: 'OFFICE' }]) },
      userPermission: { findMany: jest.fn().mockResolvedValue([]) },
      rolePermission: { findMany: jest.fn().mockResolvedValue([{ permissionCode: 'students.read' }]) },
    };
    const guard = new PermissionsGuard(reflector as any, prisma as any);
    const { context } = makeContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
