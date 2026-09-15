import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { AdmitApplicationDto } from './dto/admit-application.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ReviewApplicationDto } from './dto/review-application.dto';
import { ApplicationsService } from './applications.service';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  create(@Body() dto: CreateApplicationDto) { return this.applications.create(dto); }

  @Get('track/:trackingCode')
  getStatus(@Param('trackingCode') trackingCode: string) { return this.applications.findByTrackingCode(trackingCode); }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.APPLICATIONS_READ)
  @Get()
  list() {
    return this.applications.listForStaff();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.APPLICATIONS_REVIEW)
  @Post(':id/review')
  review(@Param('id') id: string, @Body() dto: ReviewApplicationDto, @Req() request: AuthenticatedRequest) {
    return this.applications.review(id, dto.status, dto.reason, request.user.id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.APPLICATIONS_ADMIT)
  @Post(':id/admit')
  admit(@Param('id') id: string, @Body() dto: AdmitApplicationDto, @Req() request: AuthenticatedRequest) {
    return this.applications.admit(id, dto, request.user.id);
  }
}
