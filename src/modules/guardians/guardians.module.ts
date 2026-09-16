import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { GuardianIntegrityService } from './guardian-integrity.service';
import { GuardiansController } from './guardians.controller';
import { GuardiansService } from './guardians.service';

@Module({
  imports: [AuthModule],
  controllers: [GuardiansController],
  providers: [GuardiansService, GuardianIntegrityService, PrismaService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
