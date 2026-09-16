import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { ApplicationQueueService } from './application-queue.service';

@Controller('applications/queue')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApplicationQueueController {
  constructor(private readonly queue: ApplicationQueueService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.APPLICATIONS_READ)
  getQueue() {
    return this.queue.getQueue();
  }
}
