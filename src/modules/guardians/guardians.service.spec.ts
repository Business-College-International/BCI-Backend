import { ConflictException, NotFoundException } from '@nestjs/common';
import { GuardiansService } from './guardians.service';

type MockPrisma = {
  guardian: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
  $transaction: jest.Mock;
};

function makePrisma(): MockPrisma {
  return {
    guardian: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
      person: { update: jest.fn().mockResolvedValue({
        id: 'person-1',
        firstName: 'Ama',
        middleName: null,
        lastName: 'Doe',
        phone: '+233200000000',
        email: 'ama@example.com',
        address: 'Accra',
        occupation: 'Teacher',
        hometown: 'Accra',
        region: 'Greater Accra',
      }) },
      user: { update: jest.fn() },
      guardian: { update: jest.fn().mockResolvedValue({ preferredSms: true, preferredPush: false }) },
      auditLog: { create: jest.fn() },
    })),
  };
}

describe('GuardiansService profile boundary', () => {
  const existingGuardian = {
    personId: 'person-1',
    userId: 'user-1',
    preferredSms: true,
    preferredPush: true,
    person: {
      firstName: 'Ama',
      middleName: null,
      lastName: 'Doe',
      phone: '+233200000000',
      email: 'old@example.com',
      address: null,
      occupation: null,
      hometown: null,
      region: null,
    },
    user: { phone: '+233200000000', email: 'old@example.com' },
  };

  it('updates only the authenticated guardian profile and returns committed values', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue(existingGuardian);
    const service = new GuardiansService(prisma as never);

    const result = await service.updateMyProfile('user-1', {
      firstName: 'Ama',
      lastName: 'Doe',
      email: 'ama@example.com',
      address: 'Accra',
      occupation: 'Teacher',
      hometown: 'Accra',
      region: 'Greater Accra',
      preferredSms: true,
      preferredPush: false,
    });

    expect(result.email).toBe('ama@example.com');
    expect(result.preferredPush).toBe(false);
  });

  it('rejects a phone number owned by another user', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue(existingGuardian);
    prisma.user.findUnique.mockResolvedValue({ id: 'other-user' });
    const service = new GuardiansService(prisma as never);

    await expect(service.updateMyProfile('user-1', {
      firstName: 'Ama',
      lastName: 'Doe',
      phone: '+233244444444',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects updates when the authenticated account is not a guardian', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue(null);
    const service = new GuardiansService(prisma as never);

    await expect(service.updateMyProfile('user-9', {
      firstName: 'Test',
      lastName: 'User',
    })).rejects.toBeInstanceOf(NotFoundException);
  });
});
