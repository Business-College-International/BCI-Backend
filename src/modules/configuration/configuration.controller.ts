import { Body, Controller, Get, Param, Post, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Level, Programme, RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { CreateFeeScheduleDto } from './dto/create-fee-schedule.dto';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { ConfigurationService } from './configuration.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('configuration')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConfigurationController {
  constructor(private readonly configuration: ConfigurationService) {}

  @Get('subjects')
  @RequirePermissions(PERMISSIONS.ACADEMICS_READ)
  listSubjects(@Query('level') level?: Level, @Query('programme') programme?: Programme, @Query('isElective') isElective?: string, @Query('isActive') isActive?: string) {
    return this.configuration.listSubjects({
      ...(level ? { level } : {}),
      ...(programme ? { programme } : {}),
      ...(isElective !== undefined ? { isElective: isElective === 'true' } : {}),
      ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
    });
  }

  @Post('subjects')
  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  createSubject(@Body() dto: CreateSubjectDto, @Req() request: AuthenticatedRequest) { return this.configuration.createSubject(dto, request.user.id, request.user.roles); }

  @Patch('subjects/:id')
  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  updateSubject(@Param('id') id: string, @Body() dto: UpdateSubjectDto, @Req() request: AuthenticatedRequest) { return this.configuration.updateSubject(id, dto, request.user.id, request.user.roles); }

  @Get('fee-schedules')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  listFeeSchedules(@Query('termId') termId: string, @Req() request: AuthenticatedRequest) { return this.configuration.listFeeSchedules(termId, request.user.roles); }

  @Post('fee-schedules')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  createFeeSchedule(@Body() dto: CreateFeeScheduleDto, @Req() request: AuthenticatedRequest) { return this.configuration.createFeeSchedule(dto, request.user.id, request.user.roles); }
}
