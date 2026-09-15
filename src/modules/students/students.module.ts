import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [AuthModule],
  controllers: [StudentsController],
  providers: [StudentsService, PrismaService],
  exports: [StudentsService],
})
export class StudentsModule {}
