import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';

@Module({
  controllers: [AssessmentsController],
  providers: [AssessmentsService, PrismaService],
})
export class AssessmentsModule {}
