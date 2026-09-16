import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { AnnouncementOperationsService } from './announcement-operations.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('announcements/operations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AnnouncementOperationsController {
  constructor(private readonly operations: AnnouncementOperationsService) {}

  @Get('preview')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  preview(@Query('audienceType') audienceType: string, @Query('audienceRef') audienceRef?: string) {
    return this.operations.previewAudience(audienceType, audienceRef);
  }

  @Get(':announcementId/delivery-report')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  deliveryReport(@Param('announcementId') announcementId: string) {
    return this.operations.getDeliveryReport(announcementId);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  summary(@Req() request: AuthenticatedRequest) {
    return this.operations.getManagerSummary(request.user.roles);
  }
}
