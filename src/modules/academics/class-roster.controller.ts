import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { ClassRosterService } from './class-roster.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('school-classes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.ACADEMICS_READ)
export class ClassRosterController {
  constructor(private readonly roster: ClassRosterService) {}

  @Get(':classId/roster')
  getRoster(@Param('classId') classId: string, @Req() request: AuthenticatedRequest) {
    const termId = typeof request.query.termId === 'string' ? request.query.termId : '';
    return this.roster.getRoster(classId, termId, request.user.id, request.user.roles);
  }
}
