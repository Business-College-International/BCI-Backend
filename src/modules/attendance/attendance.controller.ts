import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceSessionDto } from './dto/create-attendance-session.dto';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('attendance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('sessions')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  createSession(
    @Body() dto: CreateAttendanceSessionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attendance.createSession(dto, request.user.id, request.user.roles);
  }

  @Get('sessions/:sessionId/roster')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_READ)
  getSessionRoster(
    @Param('sessionId') sessionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attendance.getSessionRoster(sessionId, request.user.id, request.user.roles);
  }

  @Post('sessions/:sessionId/records')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  markAttendance(
    @Param('sessionId') sessionId: string,
    @Body() dto: MarkAttendanceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attendance.markAttendance(sessionId, dto, request.user.id, request.user.roles);
  }

  @Get('students/:studentId')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_READ)
  getStudentAttendance(
    @Param('studentId') studentId: string,
    @Query('termId') termId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.attendance.getStudentAttendance(studentId, request.user.id, request.user.roles, termId);
  }
}
