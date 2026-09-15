import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { CreateFeeScheduleDto } from './dto/create-fee-schedule.dto';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { ListFeeSchedulesDto } from './dto/list-fee-schedules.dto';
import { FinanceSummaryDto } from './dto/finance-summary.dto';
import { FinanceService } from './finance.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('fee-schedules')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  listFeeSchedules(
    @Query() query: ListFeeSchedulesDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.finance.listFeeSchedules(query.termId, request.user.id, request.user.roles);
  }

  @Post('fee-schedules')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  createFeeSchedule(
    @Body() dto: CreateFeeScheduleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.finance.createFeeSchedule(dto, request.user.id);
  }

  @Post('invoices')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  issueInvoice(
    @Body() dto: IssueInvoiceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.finance.issueInvoice(dto, request.user.id);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  getSummary(
    @Query() query: FinanceSummaryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.finance.getFinanceSummary(query, request.user.id, request.user.roles);
  }

  @Get('students/:studentId/invoices')
  listStudentInvoices(
    @Param('studentId') studentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.finance.listStudentInvoices(studentId, request.user.id, request.user.roles);
  }

  @Get('students/:studentId/receipts')
  listStudentReceipts(
    @Param('studentId') studentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.finance.listStudentReceipts(studentId, request.user.id, request.user.roles);
  }
}
