import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async checkReadiness() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok' as const,
      checks: {
        database: 'ok' as const,
      },
    };
  }
}
