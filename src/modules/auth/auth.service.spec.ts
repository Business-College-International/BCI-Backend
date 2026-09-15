import { UnauthorizedException } from '@nestjs/common';
import { RoleName, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';

function makePrisma() {
  return {
    user: { findUnique: jest.fn() },
    rolePermission: { findMany: jest.fn() },
    $transaction: jest.fn(),
  } as never;
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

    const service = new AuthService(prisma, { signAsync: jest.fn() } as never);
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

    const service = new AuthService(prisma, { signAsync: jest.fn() } as never);

    await expect(service.getCurrentUser('user-2')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
