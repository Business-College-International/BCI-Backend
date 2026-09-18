-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('DIRECTOR', 'PRINCIPAL', 'OFFICE', 'ACCOUNTANT', 'TEACHER', 'SUPPORT_STAFF', 'GUARDIAN', 'APPLICANT');

-- CreateEnum
CREATE TYPE "Level" AS ENUM ('KG1', 'KG2', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'JHS1', 'JHS2', 'JHS3', 'SHS1', 'SHS2', 'SHS3');

-- CreateEnum
CREATE TYPE "Programme" AS ENUM ('NONE', 'AGRIC', 'GENERAL_ARTS', 'BUSINESS', 'HOME_ECONOMICS');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'ADMITTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'WITHDRAWN', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "TermStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('CLASSWORK', 'TEST', 'EXAM', 'PROJECT', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('FEE', 'WALLET_TOP_UP', 'STATIONERY', 'OTHER');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('TOP_UP', 'WITHDRAWAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'PROCESSING', 'PAID', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AdmissionDecision" AS ENUM ('ADMITTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'LOGIN', 'LOGOUT', 'DISBURSE', 'RECONCILE');

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "hometown" TEXT,
    "region" TEXT,
    "occupation" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "personId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "scopeType" TEXT,
    "scopeId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseJson" JSONB,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicYear" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Term" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "TermStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guardian" (
    "personId" TEXT NOT NULL,
    "userId" TEXT,
    "occupationOverride" TEXT,
    "preferredSms" BOOLEAN NOT NULL DEFAULT true,
    "preferredPush" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "GuardianStudent" (
    "id" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "isPrimaryContact" BOOLEAN NOT NULL DEFAULT false,
    "canViewAcademic" BOOLEAN NOT NULL DEFAULT true,
    "canPayFees" BOOLEAN NOT NULL DEFAULT true,
    "canManageWallet" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GuardianStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "personId" TEXT NOT NULL,
    "userId" TEXT,
    "staffIdNo" TEXT NOT NULL,
    "department" TEXT,
    "employmentDate" TIMESTAMP(3),
    "contractType" TEXT,
    "employmentStatus" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("personId")
);

-- CreateTable
CREATE TABLE "StaffDuty" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "assignedByUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StaffDuty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolClass" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "programme" "Programme" NOT NULL DEFAULT 'NONE',
    "division" TEXT,
    "room" TEXT,
    "capacity" INTEGER,

    CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "isElective" BOOLEAN NOT NULL DEFAULT false,
    "programme" "Programme" NOT NULL DEFAULT 'NONE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrolment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "programme" "Programme" NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "exitReason" TEXT,

    CONSTRAINT "Enrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherAssignment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,

    CONSTRAINT "TeacherAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "staffId" TEXT NOT NULL,
    "basePay" DECIMAL(12,2) NOT NULL,
    "allowances" JSONB,
    "deductions" JSONB,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("staffId")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "grossPay" DECIMAL(12,2) NOT NULL,
    "totalDeductions" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "calculationJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementAttempt" (
    "id" TEXT NOT NULL,
    "payrollPeriodId" TEXT,
    "payrollEntryId" TEXT,
    "staffId" TEXT,
    "purpose" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "DisbursementStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerReference" TEXT,
    "idempotencyKey" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,

    CONSTRAINT "DisbursementAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "admissionNumber" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "sex" TEXT,
    "hometown" TEXT,
    "region" TEXT,
    "passportPhotoUrl" TEXT,
    "previousSchool" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "admittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentDocument" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentElective" (
    "id" TEXT NOT NULL,
    "enrolmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,

    CONSTRAINT "StudentElective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionDecisionRecord" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "decision" "AdmissionDecision" NOT NULL,
    "decidedBy" TEXT,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionDecisionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "levelApplied" "Level" NOT NULL,
    "programmeApplied" "Programme" NOT NULL DEFAULT 'NONE',
    "guardianName" TEXT NOT NULL,
    "guardianPhone" TEXT NOT NULL,
    "previousSchool" TEXT,
    "passportPhotoUrl" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT,
    "teacherId" TEXT,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "periodLabel" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "markedBy" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "AssessmentType" NOT NULL,
    "maxScore" DECIMAL(8,2) NOT NULL,
    "weight" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResult" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "remark" TEXT,
    "enteredBy" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeSchedule" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "programme" "Programme" NOT NULL DEFAULT 'NONE',
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentInvoice" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "StudentInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "feeScheduleId" TEXT,
    "description" TEXT NOT NULL,
    "amountDue" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT,
    "guardianId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "purpose" "PaymentPurpose" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerReference" TEXT,
    "clientReference" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderAttempt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,

    CONSTRAINT "PaymentProviderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "fileUrl" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialJournalEntry" (
    "id" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "transactionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountCode" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT,

    CONSTRAINT "FinancialJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "providerReference" TEXT,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "studentId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("studentId")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "providerReference" TEXT,
    "processedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationeryItem" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StationeryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationeryOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "paymentId" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),

    CONSTRAINT "StationeryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationeryOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "StationeryOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "movementType" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "description" TEXT,
    "receiptUrl" TEXT,
    "enteredBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL,
    "audienceRef" TEXT,
    "sentBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT,
    "recipientUserId" TEXT,
    "channel" TEXT NOT NULL,
    "provider" TEXT,
    "providerReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorPersonId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "requestId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_personId_key" ON "User"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_revokedAt_expiresAt_idx" ON "RefreshSession"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "RolePermission_permissionCode_role_idx" ON "RolePermission"("permissionCode", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_permissionCode_key" ON "RolePermission"("role", "permissionCode");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_role_key" ON "UserRole"("userId", "role");

-- CreateIndex
CREATE INDEX "UserPermission_userId_permissionCode_idx" ON "UserPermission"("userId", "permissionCode");

-- CreateIndex
CREATE INDEX "UserPermission_permissionCode_scopeType_scopeId_idx" ON "UserPermission"("permissionCode", "scopeType", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_operation_key" ON "IdempotencyKey"("userId", "key", "operation");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_name_key" ON "AcademicYear"("name");

-- CreateIndex
CREATE INDEX "Term_status_startsAt_idx" ON "Term"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Term_academicYearId_code_key" ON "Term"("academicYearId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Guardian_userId_key" ON "Guardian"("userId");

-- CreateIndex
CREATE INDEX "GuardianStudent_studentId_isPrimaryContact_idx" ON "GuardianStudent"("studentId", "isPrimaryContact");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianStudent_guardianId_studentId_key" ON "GuardianStudent"("guardianId", "studentId");

-- CreateIndex
CREATE INDEX "EmergencyContact_personId_idx" ON "EmergencyContact"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_userId_key" ON "Staff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_staffIdNo_key" ON "Staff"("staffIdNo");

-- CreateIndex
CREATE INDEX "StaffDuty_staffId_active_idx" ON "StaffDuty"("staffId", "active");

-- CreateIndex
CREATE INDEX "SchoolClass_academicYearId_level_programme_idx" ON "SchoolClass"("academicYearId", "level", "programme");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClass_academicYearId_name_key" ON "SchoolClass"("academicYearId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_code_key" ON "Subject"("code");

-- CreateIndex
CREATE INDEX "Enrolment_classId_termId_status_idx" ON "Enrolment"("classId", "termId", "status");

-- CreateIndex
CREATE INDEX "Enrolment_studentId_academicYearId_idx" ON "Enrolment"("studentId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrolment_studentId_termId_key" ON "Enrolment"("studentId", "termId");

-- CreateIndex
CREATE INDEX "TeacherAssignment_staffId_termId_idx" ON "TeacherAssignment"("staffId", "termId");

-- CreateIndex
CREATE INDEX "TeacherAssignment_classId_termId_idx" ON "TeacherAssignment"("classId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAssignment_staffId_classId_subjectId_termId_key" ON "TeacherAssignment"("staffId", "classId", "subjectId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_code_key" ON "PayrollPeriod"("code");

-- CreateIndex
CREATE INDEX "PayrollEntry_staffId_periodId_idx" ON "PayrollEntry"("staffId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_periodId_staffId_key" ON "PayrollEntry"("periodId", "staffId");

-- CreateIndex
CREATE INDEX "DisbursementAttempt_status_requestedAt_idx" ON "DisbursementAttempt"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "DisbursementAttempt_provider_providerReference_idx" ON "DisbursementAttempt"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Student_applicationId_key" ON "Student"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_admissionNumber_key" ON "Student"("admissionNumber");

-- CreateIndex
CREATE INDEX "StudentDocument_studentId_type_idx" ON "StudentDocument"("studentId", "type");

-- CreateIndex
CREATE INDEX "StudentElective_studentId_subjectId_idx" ON "StudentElective"("studentId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentElective_enrolmentId_subjectId_key" ON "StudentElective"("enrolmentId", "subjectId");

-- CreateIndex
CREATE INDEX "AdmissionDecisionRecord_applicationId_decidedAt_idx" ON "AdmissionDecisionRecord"("applicationId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_trackingCode_key" ON "Application"("trackingCode");

-- CreateIndex
CREATE INDEX "Application_status_submittedAt_idx" ON "Application"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "Application_guardianPhone_submittedAt_idx" ON "Application"("guardianPhone", "submittedAt");

-- CreateIndex
CREATE INDEX "AttendanceSession_termId_sessionDate_idx" ON "AttendanceSession"("termId", "sessionDate");

-- CreateIndex
CREATE INDEX "AttendanceSession_classId_sessionDate_idx" ON "AttendanceSession"("classId", "sessionDate");

-- CreateIndex
CREATE INDEX "AttendanceRecord_studentId_markedAt_idx" ON "AttendanceRecord"("studentId", "markedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_sessionId_studentId_key" ON "AttendanceRecord"("sessionId", "studentId");

-- CreateIndex
CREATE INDEX "Assessment_termId_subjectId_idx" ON "Assessment"("termId", "subjectId");

-- CreateIndex
CREATE INDEX "AssessmentResult_studentId_assessmentId_idx" ON "AssessmentResult"("studentId", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResult_assessmentId_studentId_key" ON "AssessmentResult"("assessmentId", "studentId");

-- CreateIndex
CREATE INDEX "FeeSchedule_termId_level_programme_isActive_idx" ON "FeeSchedule"("termId", "level", "programme", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FeeSchedule_termId_itemCode_level_programme_key" ON "FeeSchedule"("termId", "itemCode", "level", "programme");

-- CreateIndex
CREATE UNIQUE INDEX "StudentInvoice_invoiceNumber_key" ON "StudentInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "StudentInvoice_studentId_termId_status_idx" ON "StudentInvoice"("studentId", "termId", "status");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_studentId_createdAt_idx" ON "Payment"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_guardianId_createdAt_idx" ON "Payment"("guardianId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_provider_providerReference_idx" ON "Payment"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "PaymentProviderAttempt_paymentId_requestedAt_idx" ON "PaymentProviderAttempt"("paymentId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderAttempt_provider_providerReference_key" ON "PaymentProviderAttempt"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_provider_receivedAt_idx" ON "ProviderWebhookEvent"("provider", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderWebhookEvent_provider_eventId_key" ON "ProviderWebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_invoiceId_key" ON "PaymentAllocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_receiptNumber_key" ON "Receipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialJournalEntry_entryNumber_key" ON "FinancialJournalEntry"("entryNumber");

-- CreateIndex
CREATE INDEX "FinancialJournalEntry_accountCode_transactionAt_idx" ON "FinancialJournalEntry"("accountCode", "transactionAt");

-- CreateIndex
CREATE INDEX "FinancialJournalEntry_referenceType_referenceId_idx" ON "FinancialJournalEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "Refund_paymentId_status_idx" ON "Refund"("paymentId", "status");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_providerReference_idx" ON "WalletTransaction"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "StationeryItem_sku_key" ON "StationeryItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "StationeryOrder_orderNumber_key" ON "StationeryOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "StationeryOrder_studentId_orderedAt_idx" ON "StationeryOrder"("studentId", "orderedAt");

-- CreateIndex
CREATE INDEX "StationeryOrder_guardianId_orderedAt_idx" ON "StationeryOrder"("guardianId", "orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StationeryOrderLine_orderId_itemId_key" ON "StationeryOrderLine"("orderId", "itemId");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_createdAt_idx" ON "StockMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "Expense_status_createdAt_idx" ON "Expense"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_publishedAt_createdAt_idx" ON "Announcement"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_recipientUserId_channel_createdAt_idx" ON "NotificationDelivery"("recipientUserId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_provider_providerReference_idx" ON "NotificationDelivery"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Term" ADD CONSTRAINT "Term_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianStudent" ADD CONSTRAINT "GuardianStudent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("personId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianStudent" ADD CONSTRAINT "GuardianStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDuty" ADD CONSTRAINT "StaffDuty_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("personId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryStructure" ADD CONSTRAINT "SalaryStructure_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("personId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementAttempt" ADD CONSTRAINT "DisbursementAttempt_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementAttempt" ADD CONSTRAINT "DisbursementAttempt_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementAttempt" ADD CONSTRAINT "DisbursementAttempt_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentElective" ADD CONSTRAINT "StudentElective_enrolmentId_fkey" FOREIGN KEY ("enrolmentId") REFERENCES "Enrolment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentElective" ADD CONSTRAINT "StudentElective_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentElective" ADD CONSTRAINT "StudentElective_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDecisionRecord" ADD CONSTRAINT "AdmissionDecisionRecord_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeSchedule" ADD CONSTRAINT "FeeSchedule_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentInvoice" ADD CONSTRAINT "StudentInvoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentInvoice" ADD CONSTRAINT "StudentInvoice_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "StudentInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_feeScheduleId_fkey" FOREIGN KEY ("feeScheduleId") REFERENCES "FeeSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderAttempt" ADD CONSTRAINT "PaymentProviderAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "StudentInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("studentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationeryOrderLine" ADD CONSTRAINT "StationeryOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StationeryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationeryOrderLine" ADD CONSTRAINT "StationeryOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StationeryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "StationeryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorPersonId_fkey" FOREIGN KEY ("actorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

