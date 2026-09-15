import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { StudentRecordsController } from './student-records.controller';
import { StudentRecordsService } from './student-records.service';

@Module({
  imports: [AuthModule],
  controllers: [StudentRecordsController],
  providers: [StudentRecordsService, PrismaService],
})
export class StudentRecordsModule {}
