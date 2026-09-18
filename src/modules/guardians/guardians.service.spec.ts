import { NotFoundException } from '@nestjs/common';
import { GuardiansService } from './guardians.service';

type MockPrisma = {
  guardian: { findUnique: jest.Mock };
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
};

function makePrisma(): MockPrisma {
  return {
    guardian: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({
      guardian: { findUnique: jest.fn().mockResolvedValue(existingGuardian), update: jest.fn().mockResolvedValue({ preferredSms: true, preferredPush: false }) },
      person: { update: jest.fn().mockResolvedValue({
        id: 'person-1',
        firstName: 'Ama',
        middleName: null,
        lastName: 'Doe',
        phone: '+233200000000',
        email: 'old@example.com',
        address: 'Accra',
        occupation: 'Teacher',
        hometown: 'Accra',
        region: 'Greater Accra',
      }) },

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
  };

  it('updates only the authenticated guardian profile and leaves login identifiers unchanged', async () => {
    const prisma = makePrisma();
    prisma.guardian.findUnique.mockResolvedValue(existingGuardian);
    const txGuardian = existingGuardian;
    const service = new GuardiansService(prisma as never);

    const result = await service.updateMyProfile('user-1', {
      firstName: 'Ama',
      lastName: 'Doe',
      address: 'Accra',
      occupation: 'Teacher',
      hometown: 'Accra',
      region: 'Greater Accra',
      preferredSms: true,
      preferredPush: false,
    });

    expect(result.phone).toBe('+233200000000');
    expect(result.email).toBe('old@example.com');
    expect(result.address).toBe('Accra');
    expect(result.preferredPush).toBe(false);
  });

  it('locks the guardian profile before applying concurrent preference updates', async () => {
    const prisma = makePrisma();
    const tx = {
      $queryRaw: prisma.$queryRaw,
      guardian: {
        findUnique: jest.fn().mockResolvedValue(existingGuardian),
        update: jest.fn().mockResolvedValue({ preferredSms: false, preferredPush: true }),
      },
      person: {
        update: jest.fn().mockResolvedValue({ ...existingGuardian.person, firstName: 'Ama', lastName: 'Doe' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof tx) => unknown) => callback(tx));

    await new GuardiansService(prisma as never).updateMyProfile('user-1', {
      firstName: 'Ama',
      lastName: 'Doe',
      preferredSms: false,
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.guardian.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      include: { person: true },
    });
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
