import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { StudentRecordCompletenessService } from './student-record-completeness.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('student-records/completeness')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StudentRecordCompletenessController {
  constructor(private readonly completeness: StudentRecordCompletenessService) {}

  @Get('students/:studentId')
  @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  getStudent(@Param('studentId') studentId: string, @Req() request: AuthenticatedRequest) {
    return this.completeness.getStudentCompleteness(studentId, request.user.roles);
  }
}
