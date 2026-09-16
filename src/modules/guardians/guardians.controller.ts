import { Body, Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { GuardianIntegrityService } from './guardian-integrity.service';
import { GuardiansService } from './guardians.service';
import { ListGuardiansDto } from './dto/list-guardians.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('guardians')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GuardiansController {
  constructor(
    private readonly guardians: GuardiansService,
    private readonly integrity: GuardianIntegrityService,
  ) {}

  @Get('directory')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  listDirectory(@Query() query: ListGuardiansDto, @Req() request: AuthenticatedRequest) {
    return this.guardians.listDirectory(query, request.user.roles);
  }

  @Get('integrity')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  getIntegrity(@Req() request: AuthenticatedRequest) {
    return this.integrity.get(request.user.roles);
  }

  @Get('me/profile')
  getMyProfile(@Req() request: AuthenticatedRequest) {
    return this.guardians.getMyProfile(request.user.id);
  }

  @Patch('me/profile')
  updateMyProfile(@Body() dto: UpdateMyProfileDto, @Req() request: AuthenticatedRequest) {
    return this.guardians.updateMyProfile(request.user.id, dto);
  }
}
