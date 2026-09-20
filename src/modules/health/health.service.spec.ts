import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports the database as ready when PostgreSQL responds', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const service = new HealthService(prisma as never);

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'ok' },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('propagates database probe failures to the controller boundary', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const service = new HealthService(prisma as never);

    await expect(service.checkReadiness()).rejects.toThrow('database unavailable');
  });
});
