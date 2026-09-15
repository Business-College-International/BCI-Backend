import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PERMISSIONS } from '../auth/permission-catalog';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { AnnouncementsService } from './announcements.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('announcements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.announcements.listForUser(request.user.id, request.user.roles);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  create(@Body() dto: CreateAnnouncementDto, @Req() request: AuthenticatedRequest) {
    return this.announcements.create(dto, request.user.id, request.user.roles);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENTS_MANAGE)
  publish(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.announcements.publish(id, request.user.id, request.user.roles);
  }
}
