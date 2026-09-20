-- Link each refund to its own immutable compensating wallet transaction.
ALTER TABLE "WalletTransaction"
ADD COLUMN "refundId" TEXT;

CREATE UNIQUE INDEX "WalletTransaction_refundId_key"
ON "WalletTransaction"("refundId");

ALTER TABLE "WalletTransaction"
ADD CONSTRAINT "WalletTransaction_refundId_fkey"
FOREIGN KEY ("refundId") REFERENCES "Refund"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
