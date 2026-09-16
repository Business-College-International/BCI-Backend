import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { CreateClassDto } from './dto/create-class.dto';
import { CreateTermDto } from './dto/create-term.dto';
import { TransitionTermDto } from './dto/transition-term.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { AcademicsService } from './academics.service';
import { TermLifecycleService } from './term-lifecycle.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AcademicsController {
  constructor(
    private readonly academics: AcademicsService,
    private readonly termLifecycle: TermLifecycleService,
  ) {}

  @RequirePermissions(PERMISSIONS.ACADEMICS_READ)
  @Get('academic-years')
  listAcademicYears() { return this.academics.listAcademicYears(); }

  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  @Post('academic-years')
  createAcademicYear(@Body() dto: CreateAcademicYearDto, @Req() request: AuthenticatedRequest) {
    return this.academics.createAcademicYear(dto, request.user.id);
  }

  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  @Post('academic-years/:id/current')
  setCurrentAcademicYear(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.academics.setCurrentAcademicYear(id, request.user.id);
  }

  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  @Post('academic-years/:id/terms')
  createTerm(@Param('id') id: string, @Body() dto: CreateTermDto, @Req() request: AuthenticatedRequest) {
    return this.termLifecycle.createTerm(id, dto, request.user.id);
  }

  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  @Patch('terms/:id/status')
  transitionTerm(@Param('id') id: string, @Body() dto: TransitionTermDto, @Req() request: AuthenticatedRequest) {
    return this.termLifecycle.transitionTerm(id, dto.status, request.user.id);
  }

  @RequirePermissions(PERMISSIONS.ACADEMICS_READ)
  @Get('school-classes')
  listClasses(@Req() request: AuthenticatedRequest) {
    const academicYearId = typeof request.query.academicYearId === 'string' ? request.query.academicYearId : undefined;
    return this.academics.listClasses(academicYearId, request.user.id, request.user.roles);
  }

  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  @Post('school-classes')
  createClass(@Body() dto: CreateClassDto, @Req() request: AuthenticatedRequest) {
    return this.academics.createClass(dto, request.user.id);
  }

  @RequirePermissions(PERMISSIONS.ACADEMICS_MANAGE)
  @Patch('school-classes/:id')
  updateClass(@Param('id') id: string, @Body() dto: UpdateClassDto, @Req() request: AuthenticatedRequest) {
    return this.academics.updateClass(id, dto, request.user.id);
  }
}
