import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { PayrollReadinessService } from './payroll-readiness.service';

type AuthenticatedRequest = Request & { user: { roles: RoleName[] } };

@Controller('payroll/readiness')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollReadinessController {
  constructor(private readonly readiness: PayrollReadinessService) {}

  @Get('periods/:periodId')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  getPeriodReadiness(@Param('periodId', new ParseUUIDPipe()) periodId: string, @Req() request: AuthenticatedRequest) {
    return this.readiness.getPeriodReadiness(periodId, request.user.roles);
  }
}
