import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AcademicsController } from './academics.controller';
import { AcademicsService } from './academics.service';
import { ClassRosterController } from './class-roster.controller';
import { ClassRosterService } from './class-roster.service';

@Module({
  imports: [AuthModule],
  controllers: [AcademicsController, ClassRosterController],
  providers: [AcademicsService, ClassRosterService, PrismaService],
})
export class AcademicsModule {}
