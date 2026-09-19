-- CreateEnum
CREATE TYPE "GradingPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "GradingPolicy" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "programme" "Programme",
    "status" "GradingPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,

    CONSTRAINT "GradingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingBand" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "lowerInclusive" DECIMAL(5,2) NOT NULL,
    "upperExclusive" DECIMAL(5,2),
    "pass" BOOLEAN NOT NULL,
    "descriptor" TEXT NOT NULL,
    "points" DECIMAL(8,2),
    "order" INTEGER NOT NULL,

    CONSTRAINT "GradingBand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradingPolicy_version_key" ON "GradingPolicy"("version");
CREATE INDEX "GradingPolicy_academicYearId_level_programme_status_idx" ON "GradingPolicy"("academicYearId", "level", "programme", "status");
CREATE UNIQUE INDEX "GradingBand_policyId_code_key" ON "GradingBand"("policyId", "code");
CREATE UNIQUE INDEX "GradingBand_policyId_order_key" ON "GradingBand"("policyId", "order");
CREATE INDEX "GradingBand_policyId_lowerInclusive_idx" ON "GradingBand"("policyId", "lowerInclusive");

-- AddForeignKey
ALTER TABLE "GradingPolicy" ADD CONSTRAINT "GradingPolicy_academicYearId_fkey"
  FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GradingBand" ADD CONSTRAINT "GradingBand_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "GradingPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
