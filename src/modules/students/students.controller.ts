import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StudentsService } from './students.service';

type AuthenticatedRequest = Request & {
  user: { id: string; roles: RoleName[] };
};

@Controller('students')
@UseGuards(JwtAuthGuard)
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get('me/wards')
  listMyWards(@Req() request: AuthenticatedRequest) {
    return this.students.listMyWards(request.user.id);
  }

  @Get(':id')
  getById(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.students.getByActor(id, request.user.id, request.user.roles);
  }
}
