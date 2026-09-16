import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceWriteGuard } from './attendance-write.guard';
import { AttendanceWritePolicyService } from './attendance-write-policy.service';

@Module({
  imports: [AuthModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceWriteGuard, AttendanceWritePolicyService, PrismaService],
})
export class AttendanceModule {}
