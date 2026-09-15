import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AcademicsController } from './academics.controller';
import { AcademicsService } from './academics.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AcademicsController],
  providers: [AcademicsService, PrismaService],
})
export class AcademicsModule {}
