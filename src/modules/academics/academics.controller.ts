import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { CreateClassDto } from './dto/create-class.dto';
import { CreateTermDto } from './dto/create-term.dto';
import { AcademicsService } from './academics.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller()
export class AcademicsController {
  constructor(private readonly academics: AcademicsService) {}

  @Get('academic-years')
  listAcademicYears() { return this.academics.listAcademicYears(); }

  @UseGuards(JwtAuthGuard)
  @Post('academic-years')
  createAcademicYear(@Body() dto: CreateAcademicYearDto, @Req() request: AuthenticatedRequest) {
    this.requireRole(request, [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);
    return this.academics.createAcademicYear(dto, request.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('academic-years/:id/terms')
  createTerm(@Param('id') id: string, @Body() dto: CreateTermDto, @Req() request: AuthenticatedRequest) {
    this.requireRole(request, [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);
    return this.academics.createTerm(id, dto, request.user.id);
  }

  @Get('school-classes')
  listClasses(@Req() request: Request) {
    const academicYearId = typeof request.query.academicYearId === 'string' ? request.query.academicYearId : undefined;
    return this.academics.listClasses(academicYearId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('school-classes')
  createClass(@Body() dto: CreateClassDto, @Req() request: AuthenticatedRequest) {
    this.requireRole(request, [RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);
    return this.academics.createClass(dto, request.user.id);
  }

  private requireRole(request: AuthenticatedRequest, allowed: RoleName[]) {
    if (!allowed.some((role) => request.user.roles.includes(role))) {
      throw new ForbiddenException('You do not have permission to manage academic structure.');
    }
  }
}
