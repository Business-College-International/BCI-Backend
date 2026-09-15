import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';

@Module({
  imports: [AuthModule],
  controllers: [ConfigurationController],
  providers: [ConfigurationService, PrismaService],
})
export class ConfigurationModule {}
