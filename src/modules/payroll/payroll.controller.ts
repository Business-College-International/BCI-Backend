import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { PayrollService } from './payroll.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('payroll')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('me')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  getMe(@Req() request: AuthenticatedRequest) {
    return this.payroll.getMyPayroll(request.user.id);
  }

  @Get('periods')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  getPeriods(@Req() request: AuthenticatedRequest) {
    return this.payroll.listPayrollPeriods(request.user.roles);
  }

  @Get('periods/:periodId/entries')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  getPeriodEntries(
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payroll.listPayrollPeriodEntries(periodId, request.user.roles);
  }
}
