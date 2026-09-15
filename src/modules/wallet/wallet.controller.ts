import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { WalletService } from './wallet.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('wallets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('students/:studentId')
  @RequirePermissions(PERMISSIONS.WALLET_READ)
  getStudentWallet(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.wallet.getStudentWallet(studentId, request.user.id, request.user.roles);
  }
}
