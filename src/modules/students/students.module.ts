import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { StudentLifecycleController } from './student-lifecycle.controller';
import { StudentLifecycleService } from './student-lifecycle.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [AuthModule],
  controllers: [StudentsController, StudentLifecycleController],
  providers: [StudentsService, StudentLifecycleService, PrismaService],
  exports: [StudentsService, StudentLifecycleService],
})
export class StudentsModule {}
