import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ExpenseStatus, RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { FinanceExpenseService } from './finance-expense.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance/expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceExpenseController {
  constructor(private readonly expenses: FinanceExpenseService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  list(@Query('status') status: ExpenseStatus | undefined, @Req() request: AuthenticatedRequest) {
    return this.expenses.list(status, request.user.roles);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  create(@Body() dto: CreateExpenseDto, @Headers('Idempotency-Key') idempotencyKey: string, @Req() request: AuthenticatedRequest) {
    return this.expenses.create(dto, request.user.id, request.user.roles, idempotencyKey);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  submit(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.expenses.submit(id, request.user.id, request.user.roles);
  }

  @Post(':id/decision')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  decide(@Param('id') id: string, @Body('decision') decision: 'APPROVED' | 'REJECTED', @Req() request: AuthenticatedRequest) {
    return this.expenses.decide(id, decision, request.user.id, request.user.roles);
  }
}
