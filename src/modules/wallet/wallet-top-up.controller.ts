import { Body, Controller, Headers, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { WalletTopUpDto } from './dto/wallet-top-up.dto';
import { WalletTopUpService } from './wallet-top-up.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('wallets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WalletTopUpController {
  constructor(private readonly topUp: WalletTopUpService) {}

  @Post('students/:studentId/top-up')
  @RequirePermissions(PERMISSIONS.WALLET_READ)
  initiate(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() dto: WalletTopUpDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.topUp.initiate(
      studentId,
      dto,
      request.user.id,
      request.user.roles,
      idempotencyKey,
    );
  }
}
