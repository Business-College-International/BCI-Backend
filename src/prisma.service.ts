import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getRequestId } from './common/request-context/request-context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super();

    this.$use(async (params, next) => {
      if (params.model === 'AuditLog' && params.action === 'create' && params.args?.data) {
        const requestId = getRequestId();
        if (requestId && !params.args.data.requestId) {
          params.args.data.requestId = requestId;
        }
      }
      return next(params);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
