import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { UpdateFeeScheduleDto } from './dto/update-fee-schedule.dto';
import { ConfigurationService } from './configuration.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('configuration/fee-schedules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FeeScheduleManagementController {
  constructor(private readonly configuration: ConfigurationService) {}

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateFeeScheduleDto, @Req() request: AuthenticatedRequest) {
    return this.configuration.updateFeeSchedule(id, dto, request.user.id, request.user.roles);
  }
}
