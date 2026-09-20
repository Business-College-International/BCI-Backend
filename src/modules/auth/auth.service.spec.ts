import { UnauthorizedException } from '@nestjs/common';
import { RoleName, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';

type MockPrisma = {
  user: { findUnique: jest.Mock };
  rolePermission: { findMany: jest.Mock };
  $transaction: jest.Mock;
};

function makePrisma(): MockPrisma {
  return {
    user: { findUnique: jest.fn() },
    rolePermission: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('AuthService current-user contract', () => {
  it('returns effective permissions from roles plus direct grants', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: UserStatus.ACTIVE,
      roles: [{ role: RoleName.DIRECTOR }],
      directPermissions: [
        { permissionCode: 'students.export', scopeType: 'school', scopeId: 'school-1' },
      ],
      person: {
        id: 'person-1',
        firstName: 'Abe',
        middleName: null,
        lastName: 'Doe',
        phone: '+233000000000',
        email: 'abe@example.com',
        photoUrl: null,
      },
      guardian: null,
      staff: { personId: 'person-1', staffIdNo: 'BCI-001', department: 'Administration', employmentStatus: 'active' },
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { role: RoleName.DIRECTOR, permissionCode: 'students.read' },
      { role: RoleName.DIRECTOR, permissionCode: 'finance.read' },
    ]);

    const service = new AuthService(prisma as never, { signAsync: jest.fn() } as never);
    const result = await service.getCurrentUser('user-1');

    expect(result.roles).toEqual([RoleName.DIRECTOR]);
    expect(result.permissions).toEqual(['finance.read', 'students.export', 'students.read']);
    expect(result.permissionAssignments).toEqual([
      { permissionCode: 'students.export', scopeType: 'school', scopeId: 'school-1' },
    ]);
    expect(result.staff?.staffIdNo).toBe('BCI-001');
  });

  it('rejects inactive users from current-user resolution', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      status: UserStatus.SUSPENDED,
      roles: [],
      directPermissions: [],
      person: null,
      guardian: null,
      staff: null,
    });

    const service = new AuthService(prisma as never, { signAsync: jest.fn() } as never);

    await expect(service.getCurrentUser('user-2')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});


describe('AuthService refresh-token rotation', () => {
  const activeSession: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
    user: {
      id: string;
      tokenVersion: number;
      status: UserStatus;
      roles: Array<{ role: RoleName }>;
    };
  } = {
    id: 'session-1',
    userId: 'user-1',
    tokenHash: 'hashed-token',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user: {
      id: 'user-1',
      tokenVersion: 3,
      status: UserStatus.ACTIVE,
      roles: [{ role: RoleName.GUARDIAN }],
    },
  };

  function makeRefreshPrisma(session: typeof activeSession | null, consumedCount = 1) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      refreshSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        create: jest.fn().mockResolvedValue({ id: 'session-2' }),
        updateMany: jest.fn().mockResolvedValue({ count: consumedCount }),
      },
    };

    return {
      prisma: {
        $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      },
      tx,
    };
  }

  it('locks and then consumes the refresh session exactly once', async () => {
    const { prisma, tx } = makeRefreshPrisma(activeSession);
    const jwt = { signAsync: jest.fn().mockResolvedValue('new-access-token') };
    const service = new AuthService(prisma as never, jwt as never);

    const result = await service.refresh({ refreshToken: 'raw-refresh-token' });

    expect(result.accessToken).toBe('new-access-token');
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-1', revokedAt: null },
    }));
  });

  it('rejects a replay when the stored refresh session is already revoked', async () => {
    const revoked = { ...activeSession, revokedAt: new Date() };
    const { prisma, tx } = makeRefreshPrisma(revoked);
    const service = new AuthService(prisma as never, { signAsync: jest.fn() } as never);

    await expect(service.refresh({ refreshToken: 'raw-refresh-token' }))
      .rejects.toBeInstanceOf(UnauthorizedException);

    expect(tx.refreshSession.create).not.toHaveBeenCalled();
    expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects if the atomic consume no longer owns the refresh session', async () => {
    const { prisma, tx } = makeRefreshPrisma(activeSession, 0);
    const service = new AuthService(prisma as never, { signAsync: jest.fn() } as never);

    await expect(service.refresh({ refreshToken: 'raw-refresh-token' }))
      .rejects.toBeInstanceOf(UnauthorizedException);

    expect(tx.refreshSession.create).toHaveBeenCalled();
    expect(tx.refreshSession.updateMany).toHaveBeenCalled();
  });
});
