-- CreateEnum
CREATE TYPE "WalletTransactionDirection" AS ENUM ('CREDIT', 'DEBIT');

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "direction" "WalletTransactionDirection",
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "reversalOfId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_paymentId_key" ON "WalletTransaction"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_reversalOfId_key" ON "WalletTransaction"("reversalOfId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_direction_createdAt_idx" ON "WalletTransaction"("walletId", "direction", "createdAt");

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "WalletTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

