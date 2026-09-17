import { ForbiddenException } from '@nestjs/common';
import { GuardianIntegrityService } from './guardian-integrity.service';

describe('GuardianIntegrityService', () => {
  it('requires a privileged guardian-management role', async () => {
    const prisma = { guardianStudent: { findMany: jest.fn() } } as never;
    const service = new GuardianIntegrityService(prisma);
    await expect(service.get(['TEACHER'] as any)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('flags missing and duplicate primary guardians plus permission anomalies', async () => {
    const prisma = {
      guardianStudent: {
        findMany: jest.fn().mockResolvedValue([
          {
            guardianId: 'g1', studentId: 's1', relationship: 'Mother', isPrimaryContact: false,
            canViewAcademic: true, canPayFees: true, canManageWallet: true,
          },
          {
            guardianId: 'g2', studentId: 's1', relationship: 'Father', isPrimaryContact: false,
            canViewAcademic: true, canPayFees: false, canManageWallet: true,
          },
          {
            guardianId: 'g3', studentId: 's2', relationship: 'Aunt', isPrimaryContact: true,
            canViewAcademic: true, canPayFees: true, canManageWallet: false,
          },
          {
            guardianId: 'g4', studentId: 's2', relationship: 'Uncle', isPrimaryContact: true,
            canViewAcademic: false, canPayFees: false, canManageWallet: false,
          },
        ]),
      },
    };

    const service = new GuardianIntegrityService(prisma as never);
    const result = await service.get(['DIRECTOR'] as any);

    expect(result.summary.wardCount).toBe(2);
    expect(result.summary.guardianLinkCount).toBe(4);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ studentId: 's1', code: 'NO_PRIMARY_GUARDIAN', severity: 'BLOCKING' }),
      expect.objectContaining({ studentId: 's1', guardianId: 'g2', code: 'WALLET_WITHOUT_FEE_PAYMENT', severity: 'REVIEW' }),
      expect.objectContaining({ studentId: 's2', code: 'MULTIPLE_PRIMARY_GUARDIANS', severity: 'BLOCKING', primaryCount: 2 }),
      expect.objectContaining({ studentId: 's2', guardianId: 'g4', code: 'NO_GUARDIAN_PORTAL_PERMISSIONS', severity: 'INFO' }),
    ]));
  });
});
