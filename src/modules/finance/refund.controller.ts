import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { RequestRefundDto } from './dto/request-refund.dto';
import { RefundService } from './refund.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance/refunds')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
export class RefundController {
  constructor(private readonly refunds: RefundService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.refunds.listRefunds(request.user.roles);
  }

  @Post()
  request(
    @Body() dto: RequestRefundDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.requestRefund(dto, request.user.id, request.user.roles, idempotencyKey);
  }

  @Post(':refundId/approve')
  approve(
    @Param('refundId') refundId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.approveRefund(refundId, request.user.id, request.user.roles);
  }

  @Post(':refundId/execute')
  execute(
    @Param('refundId') refundId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.executeRefund(refundId, request.user.id, request.user.roles);
  }

  @Post(':refundId/reconcile')
  reconcile(
    @Param('refundId') refundId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.reconcileRefund(refundId, request.user.id, request.user.roles);
  }
}
