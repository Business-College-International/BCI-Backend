import { Body, Controller, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentInitiationService } from './payment-initiation.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance/students')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentInitiationController {
  constructor(private readonly paymentInitiationService: PaymentInitiationService) {}

  @Post(':studentId/payments')
  @RequirePermissions(PERMISSIONS.PAYMENTS_MANAGE)
  initiate(
    @Param('studentId') studentId: string,
    @Body() dto: InitiatePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentInitiationService.initiate(
      studentId,
      dto,
      request.user.id,
      request.user.roles,
      idempotencyKey,
    );
  }
}
