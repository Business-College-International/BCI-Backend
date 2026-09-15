import { Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { AssignElectiveDto } from './dto/assign-elective.dto';
import { ProgressStudentDto } from './dto/progress-student.dto';
import { StudentLifecycleService } from './student-lifecycle.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('students')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
export class StudentLifecycleController {
  constructor(private readonly lifecycle: StudentLifecycleService) {}

  @Post(':id/electives')
  assignElective(@Param('id') id: string, @Body() dto: AssignElectiveDto, @Req() request: AuthenticatedRequest) {
    return this.lifecycle.assignElective(id, request.user.id, dto);
  }

  @Delete(':id/electives/:subjectId')
  removeElective(
    @Param('id') id: string,
    @Param('subjectId') subjectId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const termId = typeof request.query.termId === 'string' ? request.query.termId : '';
    return this.lifecycle.removeElective(id, subjectId, termId, request.user.id);
  }

  @Post(':id/progress')
  progressStudent(@Param('id') id: string, @Body() dto: ProgressStudentDto, @Req() request: AuthenticatedRequest) {
    return this.lifecycle.progressStudent(id, request.user.id, dto);
  }
}
