import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MoolreAdapter } from './moolre.adapter';
import { PaymentWebhookProcessor } from './payment-webhook.processor';
import { PaymentWebhookService } from './payment-webhook.service';

@Module({
  providers: [PrismaService, MoolreAdapter, PaymentWebhookService, PaymentWebhookProcessor],
  exports: [MoolreAdapter, PaymentWebhookService, PaymentWebhookProcessor],
})
export class PaymentProvidersModule {}
