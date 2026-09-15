import { Controller, Get, Module } from '@nestjs/common';
import { AcademicsModule } from './modules/academics/academics.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuthModule } from './modules/auth/auth.module';
import { GuardiansModule } from './modules/guardians/guardians.module';
import { StudentsModule } from './modules/students/students.module';

@Controller('health')
class HealthController {
  @Get()
  health(): { status: 'ok'; service: string; version: string } {
    return { status: 'ok', service: 'bci-backend-api', version: '0.1.0' };
  }
}

@Module({
  imports: [AuthModule, AcademicsModule, ApplicationsModule, GuardiansModule, StudentsModule],
  controllers: [HealthController],
})
export class AppModule {}
