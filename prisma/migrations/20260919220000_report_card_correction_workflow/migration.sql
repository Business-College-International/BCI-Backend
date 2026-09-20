-- CreateEnum
CREATE TYPE "ReportCardCorrectionDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ReportCardCorrectionRequest" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "targetPublicationId" TEXT NOT NULL,
    "replacementSnapshotJson" JSONB NOT NULL,
    "replacementSnapshotHash" TEXT NOT NULL,
    "gradingPolicyVersionId" TEXT,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "ReportCardCorrectionDecision" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "approvedPublicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportCardCorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportCardCorrectionRequest_studentId_termId_decision_idx" ON "ReportCardCorrectionRequest"("studentId", "termId", "decision");
CREATE INDEX "ReportCardCorrectionRequest_targetPublicationId_idx" ON "ReportCardCorrectionRequest"("targetPublicationId");
CREATE INDEX "ReportCardCorrectionRequest_requestedBy_requestedAt_idx" ON "ReportCardCorrectionRequest"("requestedBy", "requestedAt");
CREATE UNIQUE INDEX "ReportCardCorrectionRequest_approvedPublicationId_key" ON "ReportCardCorrectionRequest"("approvedPublicationId");

-- AddForeignKey
ALTER TABLE "ReportCardCorrectionRequest" ADD CONSTRAINT "ReportCardCorrectionRequest_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportCardCorrectionRequest" ADD CONSTRAINT "ReportCardCorrectionRequest_termId_fkey"
  FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportCardCorrectionRequest" ADD CONSTRAINT "ReportCardCorrectionRequest_targetPublicationId_fkey"
  FOREIGN KEY ("targetPublicationId") REFERENCES "ReportCardPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportCardCorrectionRequest" ADD CONSTRAINT "ReportCardCorrectionRequest_requestedBy_fkey"
  FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportCardCorrectionRequest" ADD CONSTRAINT "ReportCardCorrectionRequest_decidedBy_fkey"
  FOREIGN KEY ("decidedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportCardCorrectionRequest" ADD CONSTRAINT "ReportCardCorrectionRequest_gradingPolicyVersionId_fkey"
  FOREIGN KEY ("gradingPolicyVersionId") REFERENCES "GradingPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportCardCorrectionRequest" ADD CONSTRAINT "ReportCardCorrectionRequest_approvedPublicationId_fkey"
  FOREIGN KEY ("approvedPublicationId") REFERENCES "ReportCardPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
