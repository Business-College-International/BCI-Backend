import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermissions } from './permissions.decorator';
import { PERMISSIONS } from './permission-catalog';
import { PermissionReviewService } from './permission-review.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('security')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PermissionReviewController {
  constructor(private readonly reviewService: PermissionReviewService) {}

  @Get('permission-review')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  review(@Req() request: AuthenticatedRequest) {
    return this.reviewService.review(request.user.roles);
  }
}
