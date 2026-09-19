-- CreateEnum
CREATE TYPE "ReportCardPublicationStatus" AS ENUM ('DRAFT', 'READY_FOR_PUBLICATION', 'PUBLISHED', 'VOIDED');

-- CreateTable
CREATE TABLE "ReportCardPublication" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "publicationVersion" INTEGER NOT NULL,
    "status" "ReportCardPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "snapshotJson" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "gradingPolicyVersionId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportCardPublication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportCardPublication_studentId_termId_publicationVersion_key" ON "ReportCardPublication" ("studentId", "termId", "publicationVersion");
CREATE INDEX "ReportCardPublication_studentId_termId_status_idx" ON "ReportCardPublication" ("studentId", "termId", "status");
CREATE INDEX "ReportCardPublication_snapshotHash_idx" ON "ReportCardPublication" ("snapshotHash");
CREATE UNIQUE INDEX "ReportCardPublication_current_published_key" ON "ReportCardPublication" ("studentId", "termId") WHERE "status" = 'PUBLISHED';

ALTER TABLE "ReportCardPublication" ADD CONSTRAINT "ReportCardPublication_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportCardPublication" ADD CONSTRAINT "ReportCardPublication_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportCardPublication" ADD CONSTRAINT "ReportCardPublication_gradingPolicyVersionId_fkey" FOREIGN KEY ("gradingPolicyVersionId") REFERENCES "GradingPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
