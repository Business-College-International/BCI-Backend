import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { StudentLifecycleController } from './student-lifecycle.controller';
import { StudentLifecycleService } from './student-lifecycle.service';
import { StudentTerminalLifecycleController } from './student-terminal-lifecycle.controller';
import { StudentTerminalLifecycleService } from './student-terminal-lifecycle.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [AuthModule],
  controllers: [StudentsController, StudentLifecycleController, StudentTerminalLifecycleController],
  providers: [StudentsService, StudentLifecycleService, StudentTerminalLifecycleService, PrismaService],
  exports: [StudentsService, StudentLifecycleService, StudentTerminalLifecycleService],
})
export class StudentsModule {}
