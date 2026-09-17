import { Body, Controller, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { PaymentOtpService } from './payment-otp.service';
import { SubmitPaymentOtpDto } from './dto/submit-payment-otp.dto';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance/students')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentOtpController {
  constructor(private readonly paymentOtp: PaymentOtpService) {}

  @Post(':studentId/payments/:paymentId/otp')
  @RequirePermissions(PERMISSIONS.PAYMENTS_MANAGE)
  submit(
    @Param('studentId') studentId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: SubmitPaymentOtpDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.paymentOtp.submit(
      studentId,
      paymentId,
      dto,
      request.user.id,
      request.user.roles,
      idempotencyKey,
    );
  }
}
