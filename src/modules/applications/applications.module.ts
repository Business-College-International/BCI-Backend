import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { ApplicationQueueController } from './application-queue.controller';
import { ApplicationQueueService } from './application-queue.service';

@Module({
  imports: [AuthModule],
  controllers: [ApplicationsController, ApplicationQueueController],
  providers: [ApplicationsService, ApplicationQueueService, PrismaService],
  exports: [ApplicationsService, ApplicationQueueService],
})
export class ApplicationsModule {}
