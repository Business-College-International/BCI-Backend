import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AttendanceAnalyticsController } from './attendance-analytics.controller';
import { AttendanceAnalyticsService } from './attendance-analytics.service';

@Module({
  imports: [AuthModule],
  controllers: [AttendanceAnalyticsController],
  providers: [AttendanceAnalyticsService, PrismaService],
})
export class AttendanceAnalyticsModule {}
