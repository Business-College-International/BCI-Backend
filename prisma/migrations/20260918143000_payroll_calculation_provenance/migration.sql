-- Add payroll calculation provenance so maker/checker separation is durable.
ALTER TABLE "PayrollPeriod"
  ADD COLUMN "calculatedBy" TEXT,
  ADD COLUMN "calculatedAt" TIMESTAMP(3);
