import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { BillingRunDto } from './dto/billing-run.dto';
import { FinanceBillingRunService } from './finance-billing-run.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance/billing-runs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
export class FinanceBillingRunController {
  constructor(private readonly billing: FinanceBillingRunService) {}

  @Post('preview')
  preview(@Body() dto: BillingRunDto, @Req() request: AuthenticatedRequest) {
    return this.billing.preview(dto, request.user.roles);
  }

  @Post('execute')
  execute(@Body() dto: BillingRunDto, @Req() request: AuthenticatedRequest) {
    return this.billing.execute(dto, request.user.id, request.user.roles);
  }
}
