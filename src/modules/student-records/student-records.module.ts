import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { StudentRecordsController } from './student-records.controller';
import { StudentRecordCompletenessController } from './student-record-completeness.controller';
import { StudentRecordsService } from './student-records.service';
import { StudentRecordCompletenessService } from './student-record-completeness.service';

@Module({
  imports: [AuthModule],
  controllers: [StudentRecordsController, StudentRecordCompletenessController],
  providers: [StudentRecordsService, StudentRecordCompletenessService, PrismaService],
})
export class StudentRecordsModule {}
