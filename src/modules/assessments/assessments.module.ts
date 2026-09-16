import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AssessmentWriteGuard } from './assessment-write.guard';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';

@Module({
  controllers: [AssessmentsController],
  providers: [AssessmentsService, AssessmentWriteGuard, PrismaService],
})
export class AssessmentsModule {}
