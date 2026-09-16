import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuditAction, RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { AuditService } from './audit.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('logs')
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  list(
    @Query('actorUserId') actorUserId: string | undefined,
    @Query('action') action: AuditAction | undefined,
    @Query('entityType') entityType: string | undefined,
    @Query('entityId') entityId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() _request: AuthenticatedRequest,
  ) {
    return this.audit.list({
      actorUserId,
      action,
      entityType,
      entityId,
      from,
      to,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
