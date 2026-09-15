import { Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { PayrollCalculatorService } from './payroll-calculator.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('payroll/management')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollManagementController {
  constructor(private readonly calculator: PayrollCalculatorService) {}

  @Post('periods/:periodId/calculate')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  calculate(@Param('periodId', new ParseUUIDPipe()) periodId: string, @Req() request: AuthenticatedRequest) {
    return this.calculator.calculate(periodId, request.user.id, request.user.roles);
  }

  @Post('periods/:periodId/approve')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  approve(@Param('periodId', new ParseUUIDPipe()) periodId: string, @Req() request: AuthenticatedRequest) {
    return this.calculator.approve(periodId, request.user.id, request.user.roles);
  }
}
