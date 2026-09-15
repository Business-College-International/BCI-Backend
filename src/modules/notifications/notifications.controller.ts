import { Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './notifications.dto';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('me')
  listMine(@Req() request: AuthenticatedRequest, @Query() query: ListNotificationsDto) {
    return this.notifications.listMine(request.user.id, query);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.notifications.markRead(id, request.user.id);
  }

  @Post('me/read-all')
  markAllRead(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllRead(request.user.id);
  }
}
