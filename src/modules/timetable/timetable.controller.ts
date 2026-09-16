import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { TimetableService } from './timetable.service';
import { TimetableSlotInput } from './timetable.types';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('timetable')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Post('validate-draft')
  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  validateDraft(@Body() body: { termId?: string; slots?: TimetableSlotInput[] }, @Req() _request: AuthenticatedRequest) {
    return this.timetable.validateDraft(String(body.termId ?? ''), Array.isArray(body.slots) ? body.slots : []);
  }
}
