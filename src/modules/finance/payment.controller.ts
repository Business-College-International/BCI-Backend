import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentService } from './payment.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance/students')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post(':studentId/payments')
  initiate(
    @Param('studentId') studentId: string,
    @Body() dto: InitiatePaymentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.payments.initiate(studentId, dto, request.user.id, request.user.roles);
  }
}
