import { Body, Controller, Get, Param, Post, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdmitApplicationDto } from './dto/admit-application.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ReviewApplicationDto } from './dto/review-application.dto';
import { ApplicationsService } from './applications.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  create(@Body() dto: CreateApplicationDto) { return this.applications.create(dto); }

  @Get('track/:trackingCode')
  getStatus(@Param('trackingCode') trackingCode: string) { return this.applications.findByTrackingCode(trackingCode); }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Req() request: AuthenticatedRequest) {
    this.requireRole(request, [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);
    return this.applications.listForStaff();
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/review')
  review(@Param('id') id: string, @Body() dto: ReviewApplicationDto, @Req() request: AuthenticatedRequest) {
    this.requireRole(request, [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);
    return this.applications.review(id, dto.status, dto.reason, request.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/admit')
  admit(@Param('id') id: string, @Body() dto: AdmitApplicationDto, @Req() request: AuthenticatedRequest) {
    this.requireRole(request, [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);
    return this.applications.admit(id, dto, request.user.id);
  }

  private requireRole(request: AuthenticatedRequest, allowed: RoleName[]) {
    if (!allowed.some((role) => request.user.roles.includes(role))) throw new ForbiddenException('You do not have permission to manage admissions.');
  }
}
