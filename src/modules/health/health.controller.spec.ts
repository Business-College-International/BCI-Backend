import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns a lightweight liveness response without requiring the database', () => {
    const service = { checkReadiness: jest.fn() };
    const controller = new HealthController(service as never);

    expect(controller.live()).toEqual({
      status: 'ok',
      service: 'bci-backend-api',
      version: '0.1.0',
    });
    expect(service.checkReadiness).not.toHaveBeenCalled();
  });

  it('returns readiness when the database is available', async () => {
    const service = {
      checkReadiness: jest.fn().mockResolvedValue({
        status: 'ok',
        checks: { database: 'ok' },
      }),
    };
    const controller = new HealthController(service as never);

    await expect(controller.readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'ok' },
    });
  });

  it('translates a database failure into a 503 readiness response', async () => {
    const service = {
      checkReadiness: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const controller = new HealthController(service as never);

    await expect(controller.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
