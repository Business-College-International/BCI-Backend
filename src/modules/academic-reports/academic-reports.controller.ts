import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { AcademicReportsService } from './academic-reports.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('academic-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AcademicReportsController {
  constructor(private readonly reports: AcademicReportsService) {}

  @Get('students/:studentId/terms/:termId')
  @RequirePermissions(PERMISSIONS.ASSESSMENTS_READ)
  getStudentTermSummary(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('termId', new ParseUUIDPipe()) termId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reports.getStudentTermSummary(studentId, termId, request.user.id, request.user.roles);
  }
}
