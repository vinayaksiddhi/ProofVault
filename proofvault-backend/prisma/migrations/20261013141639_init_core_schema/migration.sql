-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('PRIVATE', 'PUBLIC_VERIFIABLE');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'SUBMITTED_TO_CHAIN', 'CONFIRMED_ON_CHAIN', 'REGISTRATION_FAILED', 'STALLED_NEEDS_RECONCILIATION');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'REPLACED');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('USER_REGISTERED', 'USER_LOGIN', 'USER_LOGOUT', 'DOCUMENT_UPLOADED', 'DUPLICATE_UPLOAD_BLOCKED', 'BLOCKCHAIN_SUBMITTED', 'BLOCKCHAIN_CONFIRMED', 'BLOCKCHAIN_FAILED', 'BLOCKCHAIN_REVOKED', 'VISIBILITY_CHANGED', 'VERIFICATION_ATTEMPTED', 'DOCUMENT_DOWNLOADED', 'DOCUMENT_DELETED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'PRIVATE',
    "publishTitle" BOOLEAN NOT NULL DEFAULT true,
    "publishDescription" BOOLEAN NOT NULL DEFAULT false,
    "originalFileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "sha256Hash" CHAR(64) NOT NULL,
    "hashAlgorithm" VARCHAR(32) NOT NULL DEFAULT 'SHA-256',
    "registrationStatus" "RegistrationStatus" NOT NULL DEFAULT 'UPLOADED',
    "publicVerificationToken" VARCHAR(64),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainRegistration" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "chainId" BIGINT NOT NULL,
    "contractAddress" CHAR(42) NOT NULL,
    "documentKey" CHAR(66) NOT NULL,
    "documentHash" CHAR(66) NOT NULL,
    "issuerAddress" CHAR(42) NOT NULL,
    "transactionHash" CHAR(66) NOT NULL,
    "blockNumber" BIGINT,
    "status" "TxStatus" NOT NULL DEFAULT 'SUBMITTED',
    "blockTimestamp" TIMESTAMPTZ(6),
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMPTZ(6),
    "revocationReason" TEXT,
    "registeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BlockchainRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPermission" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "granteeUserId" UUID NOT NULL,
    "permission" VARCHAR(32) NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "DocumentPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "documentId" UUID,
    "eventType" "AuditEventType" NOT NULL,
    "result" VARCHAR(32) NOT NULL,
    "requestId" VARCHAR(64) NOT NULL,
    "ipHash" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionOperation" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "chainId" BIGINT NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "txHash" CHAR(66),
    "nonce" INTEGER,
    "gasPriceGwei" DECIMAL(18,8),
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TransactionOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Document_publicVerificationToken_key" ON "Document"("publicVerificationToken");

-- CreateIndex
CREATE INDEX "Document_ownerId_idx" ON "Document"("ownerId");

-- CreateIndex
CREATE INDEX "Document_sha256Hash_idx" ON "Document"("sha256Hash");

-- CreateIndex
CREATE INDEX "Document_ownerId_sha256Hash_idx" ON "Document"("ownerId", "sha256Hash");

-- CreateIndex
CREATE INDEX "Document_visibility_idx" ON "Document"("visibility");

-- CreateIndex
CREATE INDEX "Document_registrationStatus_idx" ON "Document"("registrationStatus");

-- CreateIndex
CREATE INDEX "Document_publicVerificationToken_idx" ON "Document"("publicVerificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainRegistration_documentKey_key" ON "BlockchainRegistration"("documentKey");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainRegistration_transactionHash_key" ON "BlockchainRegistration"("transactionHash");

-- CreateIndex
CREATE INDEX "BlockchainRegistration_documentId_idx" ON "BlockchainRegistration"("documentId");

-- CreateIndex
CREATE INDEX "BlockchainRegistration_transactionHash_idx" ON "BlockchainRegistration"("transactionHash");

-- CreateIndex
CREATE INDEX "BlockchainRegistration_documentHash_idx" ON "BlockchainRegistration"("documentHash");

-- CreateIndex
CREATE INDEX "BlockchainRegistration_chainId_contractAddress_idx" ON "BlockchainRegistration"("chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "BlockchainRegistration_isRevoked_idx" ON "BlockchainRegistration"("isRevoked");

-- CreateIndex
CREATE INDEX "DocumentPermission_granteeUserId_idx" ON "DocumentPermission"("granteeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPermission_documentId_granteeUserId_key" ON "DocumentPermission"("documentId", "granteeUserId");

-- CreateIndex
CREATE INDEX "AuditLog_documentId_idx" ON "AuditLog"("documentId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_eventType_idx" ON "AuditLog"("eventType");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionOperation_idempotencyKey_key" ON "TransactionOperation"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionOperation_txHash_key" ON "TransactionOperation"("txHash");

-- CreateIndex
CREATE INDEX "TransactionOperation_documentId_idx" ON "TransactionOperation"("documentId");

-- CreateIndex
CREATE INDEX "TransactionOperation_status_idx" ON "TransactionOperation"("status");

-- CreateIndex
CREATE INDEX "TransactionOperation_idempotencyKey_idx" ON "TransactionOperation"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainRegistration" ADD CONSTRAINT "BlockchainRegistration_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPermission" ADD CONSTRAINT "DocumentPermission_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPermission" ADD CONSTRAINT "DocumentPermission_granteeUserId_fkey" FOREIGN KEY ("granteeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionOperation" ADD CONSTRAINT "TransactionOperation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
