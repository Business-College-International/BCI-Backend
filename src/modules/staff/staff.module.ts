import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { TeacherAssignmentManagementController } from './teacher-assignment-management.controller';
import { StaffService } from './staff.service';

@Module({
  controllers: [StaffController, TeacherAssignmentManagementController],
  providers: [StaffService],
})
export class StaffModule {}
