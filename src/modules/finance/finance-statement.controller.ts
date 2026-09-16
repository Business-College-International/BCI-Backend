import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { FinanceStatementService } from './finance-statement.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceStatementController {
  constructor(private readonly statements: FinanceStatementService) {}

  @Get('students/:studentId/statement')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  getStudentStatement(
    @Param('studentId') studentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.statements.getStudentStatement(studentId, request.user.id, request.user.roles);
  }
}
