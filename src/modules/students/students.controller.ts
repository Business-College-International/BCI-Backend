import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { StudentsService } from './students.service';
import { WithdrawStudentDto } from './dto/withdraw-student.dto';

type AuthenticatedRequest = Request & {
  user: { id: string; roles: RoleName[] };
};

@Controller('students')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.STUDENTS_READ)
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

  @Post(':id/withdraw')
  @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  withdraw(
    @Param('id') id: string,
    @Body() dto: WithdrawStudentDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.students.withdraw(id, request.user.id, dto);
  }
}
