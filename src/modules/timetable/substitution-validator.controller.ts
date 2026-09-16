import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { SubstitutionCandidateInput, SubstitutionValidatorService } from './substitution-validator.service';

type AuthenticatedRequest = Request & { user: { roles: RoleName[] } };

@Controller('timetable/substitutions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SubstitutionValidatorController {
  constructor(private readonly validator: SubstitutionValidatorService) {}

  @Post('validate')
  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  validate(@Body() input: SubstitutionCandidateInput, @Req() _request: AuthenticatedRequest) {
    return this.validator.validate(input);
  }
}
