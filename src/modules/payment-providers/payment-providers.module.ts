import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MoolreAdapter } from './moolre.adapter';
import { MoolreDisbursementService } from './moolre.disbursement.service';
import { PaymentWebhookProcessor } from './payment-webhook.processor';
import { PaymentWebhookService } from './payment-webhook.service';

@Module({
  providers: [PrismaService, MoolreAdapter, MoolreDisbursementService, PaymentWebhookService, PaymentWebhookProcessor],
  exports: [MoolreAdapter, MoolreDisbursementService, PaymentWebhookService, PaymentWebhookProcessor],
})
export class PaymentProvidersModule {}
