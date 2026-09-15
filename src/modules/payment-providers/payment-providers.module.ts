import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MoolreAdapter } from './moolre.adapter';
import { PaymentWebhookService } from './payment-webhook.service';

@Module({
  providers: [PrismaService, MoolreAdapter, PaymentWebhookService],
  exports: [MoolreAdapter, PaymentWebhookService],
})
export class PaymentProvidersModule {}
