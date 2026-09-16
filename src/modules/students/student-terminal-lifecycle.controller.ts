import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { TransferStudentDto } from './dto/transfer-student.dto';
import { StudentTerminalLifecycleService } from './student-terminal-lifecycle.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('students')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
export class StudentTerminalLifecycleController {
  constructor(private readonly lifecycle: StudentTerminalLifecycleService) {}

  @Get(':id/lifecycle')
  getHistory(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.lifecycle.history(id, request.user.roles);
  }

  @Post(':id/graduate')
  graduate(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const role = request.user.roles.find((value) => ['DIRECTOR', 'PRINCIPAL', 'OFFICE'].includes(value));
    return this.lifecycle.graduate(id, request.user.id, (role ?? 'OFFICE') as RoleName);
  }

  @Post(':id/transfer')
  transfer(@Param('id') id: string, @Body() dto: TransferStudentDto, @Req() request: AuthenticatedRequest) {
    return this.lifecycle.transfer(id, request.user.id, request.user.roles, dto);
  }
}
