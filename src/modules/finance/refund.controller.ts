import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.requestRefund(dto, request.user.id, request.user.roles);
  }

  @Post(':refundId/approve')
  approve(
    @Param('refundId') refundId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.refunds.approveRefund(refundId, request.user.id, request.user.roles);
  }
}
