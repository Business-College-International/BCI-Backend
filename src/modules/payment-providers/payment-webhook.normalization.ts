import { BadRequestException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

export type NormalizedPaymentWebhook = {
  provider: string;
  providerReference: string;
  clientReference: string | null;
  paymentStatus: PaymentStatus;
  amount: string | null;
  currency: string | null;
  completedAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
};

export function assertSuccessfulAmountMatches(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new BadRequestException('Provider payment amount does not match the payment record.');
  }
}

export function assertCurrencyMatches(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new BadRequestException('Provider payment currency does not match the payment record.');
  }
}
