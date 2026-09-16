import { Module } from '@nestjs/common';
import { AnnouncementOperationsController } from './announcement-operations.controller';
import { AnnouncementOperationsService } from './announcement-operations.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  controllers: [AnnouncementsController, AnnouncementOperationsController],
  providers: [AnnouncementsService, AnnouncementOperationsService],
  exports: [AnnouncementsService, AnnouncementOperationsService],
})
export class AnnouncementsModule {}
