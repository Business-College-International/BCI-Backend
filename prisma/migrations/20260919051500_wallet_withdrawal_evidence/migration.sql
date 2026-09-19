-- CreateEnum
CREATE TYPE "WalletWithdrawalStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'DISPENSED', 'REVERSED');

-- CreateTable
CREATE TABLE "WalletWithdrawal" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "WalletWithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "verifiedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "dispensedAt" TIMESTAMP(3),
    "reversedBy" TEXT,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "WalletWithdrawal_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN "withdrawalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_withdrawalId_key" ON "WalletTransaction"("withdrawalId");

-- CreateIndex
CREATE INDEX "WalletWithdrawal_studentId_requestedAt_idx" ON "WalletWithdrawal"("studentId", "requestedAt");

-- CreateIndex
CREATE INDEX "WalletWithdrawal_status_requestedAt_idx" ON "WalletWithdrawal"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "WalletWithdrawal" ADD CONSTRAINT "WalletWithdrawal_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_withdrawalId_fkey"
  FOREIGN KEY ("withdrawalId") REFERENCES "WalletWithdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
