import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { ListTeacherAssignmentsDto } from './dto/list-teacher-assignments.dto';
import { StaffService } from './staff.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('staff/teacher-assignments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TeacherAssignmentManagementController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  list(@Query() filters: ListTeacherAssignmentsDto) {
    return this.staff.listAllTeacherAssignments(filters);
  }

  @Post(':assignmentId/unassign')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  unassign(
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.staff.removeTeacherAssignment(assignmentId, request.user.id);
  }
}
