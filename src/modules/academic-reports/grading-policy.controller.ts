import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Level, Programme, RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { CreateGradingPolicyDto, UpdateGradingPolicyDto } from './dto/grading-policy.dto';
import { GradingPolicyService } from './grading-policy.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('grading-policies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GradingPolicyController {
  constructor(private readonly policies: GradingPolicyService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.GRADING_READ)
  list(
    @Query('academicYearId') academicYearId: string | undefined,
    @Query('level') level: Level | undefined,
    @Query('programme') programme: Programme | undefined,
  ) {
    return this.policies.list({ academicYearId, level, programme });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GRADING_MANAGE)
  create(@Body() dto: CreateGradingPolicyDto, @Req() request: AuthenticatedRequest) {
    return this.policies.create(request.user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.GRADING_MANAGE)
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateGradingPolicyDto, @Req() request: AuthenticatedRequest) {
    return this.policies.update(id, request.user.id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.GRADING_MANAGE)
  publish(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.policies.publish(id, request.user.id);
  }

  @Post(':id/retire')
  @RequirePermissions(PERMISSIONS.GRADING_MANAGE)
  retire(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.policies.retire(id, request.user.id);
  }
}
