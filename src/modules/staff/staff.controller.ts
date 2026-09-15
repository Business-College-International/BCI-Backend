import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { CreateStaffDutyDto } from './dto/create-staff-duty.dto';
import { CreateTeacherAssignmentDto } from './dto/create-teacher-assignment.dto';
import { StaffService } from './staff.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('staff')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('me')
  @RequirePermissions(PERMISSIONS.STAFF_READ)
  getMe(@Req() request: AuthenticatedRequest) {
    return this.staff.getMyProfile(request.user.id);
  }

  @Get('directory')
  @RequirePermissions(PERMISSIONS.STAFF_READ)
  directory(@Req() request: AuthenticatedRequest) {
    return this.staff.listDirectory(request.user.id, request.user.roles);
  }

  @Get(':staffPersonId/assignments')
  @RequirePermissions(PERMISSIONS.STAFF_READ)
  async assignments(
    @Param('staffPersonId', new ParseUUIDPipe()) staffPersonId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.staff.assertStaffReadAccess(request.user.id, request.user.roles, staffPersonId);
    return this.staff.listTeacherAssignmentsForStaff(staffPersonId);
  }

  @Post(':staffPersonId/duties')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  createDuty(
    @Param('staffPersonId', new ParseUUIDPipe()) staffPersonId: string,
    @Body() dto: CreateStaffDutyDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.staff.createDuty(staffPersonId, dto, request.user.id);
  }

  @Post(':staffPersonId/teacher-assignments')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  createTeacherAssignment(
    @Param('staffPersonId', new ParseUUIDPipe()) staffPersonId: string,
    @Body() dto: CreateTeacherAssignmentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.staff.createTeacherAssignment(staffPersonId, dto, request.user.id);
  }
}
