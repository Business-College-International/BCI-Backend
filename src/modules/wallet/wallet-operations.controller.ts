import { Body, Headers, Param, ParseUUIDPipe, Post, Req, UseGuards, Controller } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { WithdrawWalletDto } from './dto/withdraw-wallet.dto';
import { WalletOperationsService } from './wallet-operations.service';
import { ReverseWalletTransactionDto } from './dto/reverse-wallet-transaction.dto';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('wallets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WalletOperationsController {
  constructor(private readonly operations: WalletOperationsService) {}

  @Post('students/:studentId/withdraw')
  @RequirePermissions(PERMISSIONS.WALLET_MANAGE)
  withdraw(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() dto: WithdrawWalletDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.withdraw(studentId, dto, request.user.id, request.user.roles, idempotencyKey);
  }

  @Post('students/:studentId/transactions/:transactionId/reverse')
  @RequirePermissions(PERMISSIONS.WALLET_MANAGE)
  reverse(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @Body() dto: ReverseWalletTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.reverse(
      studentId,
      transactionId,
      dto,
      request.user.id,
      request.user.roles,
      idempotencyKey,
    );
  }
}
