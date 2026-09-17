import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { StationeryService } from './stationery.service';
import { CreateStationeryItemDto } from './dto/create-stationery-item.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CreateStationeryOrderDto } from './dto/create-stationery-order.dto';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('stationery')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StationeryController {
  constructor(private readonly stationery: StationeryService) {}

  @Get('catalog')
  listCatalog(@Query('includeInactive') includeInactive: string | undefined, @Req() request: AuthenticatedRequest) {
    const privileged = request.user.roles.some((role) => ([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE, RoleName.ACCOUNTANT] as RoleName[]).includes(role));
    return this.stationery.listCatalog(includeInactive === 'true' && privileged);
  }

  @Post('items')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  createItem(@Body() dto: CreateStationeryItemDto, @Req() request: AuthenticatedRequest) {
    return this.stationery.createItem(dto, request.user.id, request.user.roles);
  }

  @Post('items/:itemId/stock')
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  adjustStock(@Param('itemId') itemId: string, @Body() dto: AdjustStockDto, @Req() request: AuthenticatedRequest) {
    return this.stationery.adjustStock(itemId, dto, request.user.id, request.user.roles);
  }

  @Post('orders')
  createDraftOrder(@Body() dto: CreateStationeryOrderDto, @Req() request: AuthenticatedRequest) {
    return this.stationery.createDraftOrder(dto, request.user.id, request.user.roles);
  }

  @Get('orders/me')
  listMyOrders(@Req() request: AuthenticatedRequest) {
    return this.stationery.listMyOrders(request.user.id, request.user.roles);
  }
}
