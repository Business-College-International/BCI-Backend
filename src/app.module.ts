import { Controller, Get, Module } from '@nestjs/common';
import { ApplicationsModule } from './modules/applications/applications.module';

@Controller('health')
class HealthController {
  @Get()
  health(): { status: 'ok'; service: string; version: string } {
    return { status: 'ok', service: 'bci-backend-api', version: '0.1.0' };
  }
}

@Module({
  imports: [ApplicationsModule],
  controllers: [HealthController],
})
export class AppModule {}
