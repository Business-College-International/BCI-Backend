import { Module } from '@nestjs/common';
import { TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';
import { SubstitutionValidatorController } from './substitution-validator.controller';
import { SubstitutionValidatorService } from './substitution-validator.service';

@Module({
  controllers: [TimetableController, SubstitutionValidatorController],
  providers: [TimetableService, SubstitutionValidatorService],
  exports: [TimetableService, SubstitutionValidatorService],
})
export class TimetableModule {}
