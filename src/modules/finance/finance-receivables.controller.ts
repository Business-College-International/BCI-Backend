import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { FinanceReceivablesService } from './finance-receivables.service';
import { ListInvoicesDto } from './dto/list-invoices.dto';
import { VoidInvoiceDto } from './dto/void-invoice.dto';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance/receivables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceReceivablesController {
  constructor(private readonly receivables: FinanceReceivablesService) {}

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  listInvoices(@Query() query: ListInvoicesDto, @Req() request: AuthenticatedRequest) {
    return this.receivables.listInvoices(query, request.user.id, request.user.roles);
  }

  @Get('ageing')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  ageing(@Req() request: AuthenticatedRequest) {
    return this.receivables.ageing(request.user.id, request.user.roles);
  }

  @Patch('invoices/:invoiceId/void')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  voidInvoice(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: VoidInvoiceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.receivables.voidInvoice(invoiceId, dto, request.user.id, request.user.roles);
  }
}
