import { Controller, Headers, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { PayrollDisbursementService } from './payroll-disbursement.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('payroll/management')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollDisbursementController {
  constructor(private readonly disbursements: PayrollDisbursementService) {}

  @Post('entries/:entryId/disburse')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  disburse(
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.disbursements.initiate(entryId, request.user.id, request.user.roles, idempotencyKey);
  }

  @Post('disbursements/:attemptId/reconcile')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  reconcile(
    @Param('attemptId', new ParseUUIDPipe()) attemptId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.disbursements.reconcile(attemptId, request.user.id, request.user.roles);
  }
}
