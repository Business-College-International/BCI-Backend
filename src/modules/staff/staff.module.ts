import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { TeacherAssignmentManagementController } from './teacher-assignment-management.controller';
import { StaffManagementController } from './staff-management.controller';
import { StaffService } from './staff.service';
import { StaffManagementService } from './staff-management.service';

@Module({
  controllers: [StaffController, TeacherAssignmentManagementController, StaffManagementController],
  providers: [StaffService, StaffManagementService],
})
export class StaffModule {}
