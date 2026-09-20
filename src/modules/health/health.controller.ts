import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  live() {
    return {
      status: 'ok' as const,
      service: 'bci-backend-api',
      version: '0.1.0',
    };
  }

  @Get('live')
  liveness() {
    return {
      status: 'ok' as const,
      service: 'bci-backend-api',
      version: '0.1.0',
    };
  }

  @Get('ready')
  async readiness() {
    try {
      return await this.healthService.checkReadiness();
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        status: 'not_ready',
        checks: {
          database: 'unavailable',
        },
      });
    }
  }
}
