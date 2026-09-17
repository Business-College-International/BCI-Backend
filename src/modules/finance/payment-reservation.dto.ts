export type PaymentReservationLine = {
  invoiceId: string;
  amount: string;
};

export type CreatePaymentReservationInput = {
  studentId: string;
  guardianId?: string | null;
  amount: string;
  currency?: string;
  purpose: 'FEE' | 'WALLET_TOP_UP' | 'STATIONERY' | 'OTHER';
  idempotencyKey: string;
  clientReference: string;
  invoiceIds: string[];
  expiresInSeconds?: number;
  provider?: string;
};
