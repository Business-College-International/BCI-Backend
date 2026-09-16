import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletOperationsController } from './wallet-operations.controller';
import { WalletService } from './wallet.service';
import { WalletOperationsService } from './wallet-operations.service';

@Module({
  controllers: [WalletController, WalletOperationsController],
  providers: [WalletService, WalletOperationsService],
})
export class WalletModule {}
