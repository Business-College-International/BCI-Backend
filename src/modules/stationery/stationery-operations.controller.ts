import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { StationeryOperationsService } from './stationery-operations.service';
import { AttachStationeryPaymentDto } from './dto/attach-stationery-payment.dto';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('stationery/operations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StationeryOperationsController {
  constructor(private readonly operations: StationeryOperationsService) {}

  @Get('orders')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  listOrders(@Query('status') status: string | undefined, @Req() request: AuthenticatedRequest) {
    return this.operations.listOrders(request.user.id, request.user.roles, status);
  }

  @Post('orders/:orderId/attach-payment')
  @RequirePermissions(PERMISSIONS.PAYMENTS_MANAGE)
  attachPayment(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: AttachStationeryPaymentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.attachSuccessfulPayment(orderId, dto.paymentId, request.user.id, request.user.roles);
  }

  @Patch('orders/:orderId/ready')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  markReady(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.markReadyForCollection(orderId, request.user.id, request.user.roles);
  }

  @Patch('orders/:orderId/collected')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  markCollected(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.markCollected(orderId, request.user.id, request.user.roles);
  }

  @Patch('orders/:orderId/cancel')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  cancelDraft(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.operations.cancelDraft(orderId, request.user.id, request.user.roles);
  }
}
