import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { ReportReadinessService } from './report-readiness.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('academic-reports/readiness')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportReadinessController {
  constructor(private readonly readiness: ReportReadinessService) {}

  @Get('classes/:classId/terms/:termId')
  @RequirePermissions(PERMISSIONS.ASSESSMENTS_READ)
  getClassReadiness(
    @Param('classId', new ParseUUIDPipe()) classId: string,
    @Param('termId', new ParseUUIDPipe()) termId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.readiness.getClassReadiness(classId, termId, request.user.id, request.user.roles);
  }
}
