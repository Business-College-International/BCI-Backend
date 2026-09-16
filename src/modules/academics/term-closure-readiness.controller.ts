import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { TermClosureReadinessService } from './term-closure-readiness.service';

@Controller('terms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TermClosureReadinessController {
  constructor(private readonly readiness: TermClosureReadinessService) {}

  @Get(':id/closure-readiness')
  @RequirePermissions(PERMISSIONS.ACADEMICS_READ)
  get(@Param('id') termId: string) {
    return this.readiness.get(termId);
  }
}
