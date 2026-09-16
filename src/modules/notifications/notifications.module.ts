import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationOperationsController } from './notification-operations.controller';
import { NotificationOperationsService } from './notification-operations.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, NotificationOperationsController],
  providers: [NotificationsService, NotificationOperationsService, PrismaService],
  exports: [NotificationOperationsService],
})
export class NotificationsModule {}
