import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { GuardiansService } from './guardians.service';

describe('GuardiansService.listDirectory', () => {
  it('blocks teachers from the guardian directory', async () => {
    const service = new GuardiansService({} as never);

    await expect(service.listDirectory({}, [RoleName.TEACHER])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns a bounded guardian directory for office staff', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        personId: 'person-1',
        person: { firstName: 'Ama', middleName: null, lastName: 'Mensah', phone: '0240000000', email: 'ama@example.com' },
        _count: { wards: 2 },
      },
    ]);
    const service = new GuardiansService({ guardian: { findMany } } as never);

    await expect(service.listDirectory({ q: 'Ama' }, [RoleName.OFFICE])).resolves.toEqual([
      { personId: 'person-1', name: 'Ama Mensah', phone: '0240000000', email: 'ama@example.com', wardCount: 2 },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 250 }));
  });
});
