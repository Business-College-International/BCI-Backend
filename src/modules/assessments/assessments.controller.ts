import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { AssessmentsService } from './assessments.service';
import { AssessmentWriteGuard } from './assessment-write.guard';
import { CreateAssessmentDto } from './dto/create-assessment.dto';
import { EnterAssessmentResultsDto } from './dto/enter-assessment-results.dto';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('assessments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.ASSESSMENTS_MANAGE)
  createAssessment(
    @Body() dto: CreateAssessmentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.createAssessment(dto, request.user.id, request.user.roles);
  }

  @Get('roster')
  @RequirePermissions(PERMISSIONS.ASSESSMENTS_READ)
  getRoster(
    @Query('classId') classId: string,
    @Query('termId') termId: string,
    @Query('subjectId') subjectId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.getAssessmentRoster(
      classId,
      termId,
      subjectId,
      request.user.id,
      request.user.roles,
    );
  }

  @Get('assigned')
  @RequirePermissions(PERMISSIONS.ASSESSMENTS_READ)
  getAssignedAssessments(
    @Query('classId') classId: string,
    @Query('termId') termId: string,
    @Query('subjectId') subjectId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.listAssignedAssessments(
      classId,
      termId,
      subjectId,
      request.user.id,
      request.user.roles,
    );
  }

  @Post(':assessmentId/results')
  @UseGuards(AssessmentWriteGuard)
  @RequirePermissions(PERMISSIONS.ASSESSMENTS_MANAGE)
  enterResults(
    @Param('assessmentId') assessmentId: string,
    @Body() dto: EnterAssessmentResultsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.enterResults(assessmentId, dto, request.user.id, request.user.roles);
  }

  @Get('students/:studentId')
  @RequirePermissions(PERMISSIONS.ASSESSMENTS_READ)
  getStudentAssessments(
    @Param('studentId') studentId: string,
    @Query('termId') termId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.assessments.getStudentAssessments(studentId, request.user.id, request.user.roles, termId);
  }
}
