import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { AttendanceAnalyticsService } from './attendance-analytics.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('attendance/analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendanceAnalyticsController {
  constructor(private readonly analytics: AttendanceAnalyticsService) {}

  @Get('classes/:classId/summary')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_READ)
  getClassSummary(
    @Param('classId') classId: string,
    @Query('termId') termId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.analytics.getClassSummary(classId, termId, request.user.id, request.user.roles);
  }

  @Get('classes/:classId/chronic-absence')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_READ)
  getChronicAbsence(
    @Param('classId') classId: string,
    @Query('termId') termId: string,
    @Query('absenceRateThreshold') absenceRateThreshold: string | undefined,
    @Query('minimumSessions') minimumSessions: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.analytics.getChronicAbsence(
      classId,
      termId,
      request.user.id,
      request.user.roles,
      absenceRateThreshold ? Number(absenceRateThreshold) : undefined,
      minimumSessions ? Number(minimumSessions) : undefined,
    );
  }
}
