import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AcademicsController } from './academics.controller';
import { AcademicsService } from './academics.service';
import { ClassRosterController } from './class-roster.controller';
import { ClassRosterService } from './class-roster.service';
import { TermClosureReadinessController } from './term-closure-readiness.controller';
import { TermClosureReadinessService } from './term-closure-readiness.service';
import { TermLifecycleService } from './term-lifecycle.service';

@Module({
  imports: [AuthModule],
  controllers: [AcademicsController, ClassRosterController, TermClosureReadinessController],
  providers: [AcademicsService, ClassRosterService, TermClosureReadinessService, TermLifecycleService, PrismaService],
})
export class AcademicsModule {}
