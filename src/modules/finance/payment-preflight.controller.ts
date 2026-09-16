import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { PaymentPreflightDto } from './dto/payment-preflight.dto';
import { PaymentPreflightService } from './payment-preflight.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance/students')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentPreflightController {
  constructor(private readonly preflightService: PaymentPreflightService) {}

  @Post(':studentId/payment-preflight')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  preflight(
    @Param('studentId') studentId: string,
    @Body() dto: PaymentPreflightDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.preflightService.preflight(
      studentId,
      dto,
      request.user.id,
      request.user.roles,
    );
  }
}
