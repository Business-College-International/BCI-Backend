import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { ReportCardPublicationService } from './report-card-publication.service';
import { ReportCardCorrectionService } from './report-card-correction.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('academic-reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportCardPublicationController {
  constructor(
    private readonly publications: ReportCardPublicationService,
    private readonly corrections: ReportCardCorrectionService,
  ) {}

  @Post('students/:studentId/terms/:termId/corrections')
  @RequirePermissions(PERMISSIONS.REPORTS_CORRECTION_REQUEST)
  requestCorrection(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('termId', new ParseUUIDPipe()) termId: string,
    @Body() body: { reason?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.corrections.request(studentId, termId, body.reason ?? '', request.user.id, request.user.roles);
  }

  @Get('students/:studentId/terms/:termId/corrections')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  listCorrections(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('termId', new ParseUUIDPipe()) termId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.corrections.list(studentId, termId, request.user.id, request.user.roles);
  }

  @Post('corrections/:id/approve')
  @RequirePermissions(PERMISSIONS.REPORTS_CORRECTION_REVIEW)
  approveCorrection(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { decisionNote?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.corrections.approve(id, body.decisionNote ?? '', request.user.id, request.user.roles);
  }

  @Post('corrections/:id/reject')
  @RequirePermissions(PERMISSIONS.REPORTS_CORRECTION_REVIEW)
  rejectCorrection(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { decisionNote?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.corrections.reject(id, body.decisionNote ?? '', request.user.id, request.user.roles);
  }

  @Post('students/:studentId/terms/:termId/publications')
  @RequirePermissions(PERMISSIONS.REPORTS_PUBLISH)
  prepare(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('termId', new ParseUUIDPipe()) termId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.publications.prepare(studentId, termId, request.user.id, request.user.roles);
  }

  @Post('publications/:id/publish')
  @RequirePermissions(PERMISSIONS.REPORTS_PUBLISH)
  publish(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.publications.publish(id, request.user.id, request.user.roles);
  }

  @Post('publications/:id/void')
  @RequirePermissions(PERMISSIONS.REPORTS_PUBLISH)
  void(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { reason?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.publications.void(id, request.user.id, request.user.roles, body.reason ?? '');
  }

  @Get('students/:studentId/terms/:termId/publications/history')
  @RequirePermissions(PERMISSIONS.REPORTS_PUBLISH)
  history(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('termId', new ParseUUIDPipe()) termId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.publications.history(studentId, termId, request.user.roles);
  }

  @Get('students/:studentId/terms/:termId/publications/current')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  current(
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('termId', new ParseUUIDPipe()) termId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.publications.current(studentId, termId, request.user.id, request.user.roles);
  }
}
