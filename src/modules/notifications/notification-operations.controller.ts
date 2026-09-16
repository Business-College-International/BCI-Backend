import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { NotificationOperationsService } from './notification-operations.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('notifications/operations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationOperationsController {
  constructor(private readonly operations: NotificationOperationsService) {}

  @Get('queue')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  queue(@Req() request: AuthenticatedRequest) {
    return this.operations.listQueue(request.user.roles);
  }

  @Post(':id/requeue')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  requeue(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.operations.requeue(id, request.user.id, request.user.roles);
  }
}
