import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { UpdateStaffRecordDto } from './dto/update-staff-record.dto';
import { StaffManagementService } from './staff-management.service';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('staff-management')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StaffManagementController {
  constructor(private readonly management: StaffManagementService) {}

  @Get(':staffPersonId')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  getRecord(@Param('staffPersonId', new ParseUUIDPipe()) staffPersonId: string) {
    return this.management.getStaffRecord(staffPersonId);
  }

  @Patch(':staffPersonId')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  updateRecord(
    @Param('staffPersonId', new ParseUUIDPipe()) staffPersonId: string,
    @Body() dto: UpdateStaffRecordDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.management.updateStaffRecord(staffPersonId, dto, request.user.id);
  }

  @Post('duties/:dutyId/complete')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  completeDuty(@Param('dutyId', new ParseUUIDPipe()) dutyId: string, @Req() request: AuthenticatedRequest) {
    return this.management.completeDuty(dutyId, request.user.id);
  }
}
