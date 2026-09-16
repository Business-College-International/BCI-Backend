import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { FinanceIntegrityService } from './finance-integrity.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance/integrity')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceIntegrityController {
  constructor(private readonly integrity: FinanceIntegrityService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  getReport(@Req() request: AuthenticatedRequest) {
    return this.integrity.getIntegrityReport(request.user.id, request.user.roles);
  }
}
