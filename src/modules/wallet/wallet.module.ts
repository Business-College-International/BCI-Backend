import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletOperationsController } from './wallet-operations.controller';
import { WalletService } from './wallet.service';
import { WalletOperationsService } from './wallet-operations.service';
import { WalletTopUpController } from './wallet-top-up.controller';
import { WalletTopUpService } from './wallet-top-up.service';
import { AuthModule } from '../auth/auth.module';
import { PaymentProvidersModule } from '../payment-providers/payment-providers.module';

@Module({
  imports: [AuthModule, PaymentProvidersModule],
  controllers: [WalletController, WalletOperationsController, WalletTopUpController],
  providers: [WalletService, WalletOperationsService, WalletTopUpService],
})
export class WalletModule {}
