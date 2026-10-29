# ProofVault — Data Schema & Model Specification
**Document ID:** PV-DATA-001  
**Status:** PHASE 1 BLUEPRINT REVIEW (Updated & Finalized)  
**Last Updated:** 2026-10-11  

---

## 1. Data Ownership Matrix

| Data Entity | Authority | Storage Location | Sensitivity | Mutability |
| :--- | :--- | :--- | :--- | :--- |
| User Credentials | Backend | PostgreSQL (`User`) | Secret (bcrypt hash) | Mutable (Password change) |
| Document Metadata | Backend | PostgreSQL (`Document`) | Confidential | Mutable (Title/Description) |
| Original Document Bytes | Private Storage | Local Disk / S3 Encrypted | Confidential | Immutable (Purged on delete) |
| Canonical File Hash | Backend + Chain | PostgreSQL & Smart Contract | Public Proof | Immutable |
| On-Chain Registration | Blockchain | EVM Storage (`ProofVault.sol`) | Public Immutable | Permanent / Append-only |
| Application Audit Trail | Backend | PostgreSQL (`AuditLog`) | Internal / Verifiable | Append-only (Off-chain) |
| On-Chain Event Logs | Blockchain | EVM Receipts / Bloom Filter | Public Verifiable | Permanent |

---

## 2. Proposed PostgreSQL / Prisma Schema

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  USER
  ADMIN
}

enum UserStatus {
  ACTIVE
  SUSPENDED
  PENDING_VERIFICATION
}

enum DocumentVisibility {
  PRIVATE
  PUBLIC_VERIFIABLE
}

enum RegistrationStatus {
  PENDING_UPLOAD
  UPLOADED
  SUBMITTED_TO_CHAIN
  CONFIRMED_ON_CHAIN
  REGISTRATION_FAILED
  STALLED_NEEDS_RECONCILIATION
}

enum TxStatus {
  NOT_STARTED
  PENDING
  SUBMITTED
  CONFIRMED
  FAILED
  REPLACED
}

enum AuditEventType {
  USER_REGISTERED
  USER_LOGIN
  DOCUMENT_UPLOADED
  DUPLICATE_UPLOAD_BLOCKED
  BLOCKCHAIN_SUBMITTED
  BLOCKCHAIN_CONFIRMED
  BLOCKCHAIN_FAILED
  VISIBILITY_CHANGED
  VERIFICATION_ATTEMPTED
  DOCUMENT_DOWNLOADED
  DOCUMENT_DELETED
}

model User {
  id           String       @id @default(uuid()) @db.Uuid
  email        String       @unique @db.VarChar(255)
  passwordHash String       @db.VarChar(255) // bcrypt factor 12
  role         Role         @default(USER)
  status       UserStatus   @default(ACTIVE)
  createdAt    DateTime     @default(now()) @db.Timestamptz(6)
  updatedAt    DateTime     @updatedAt @db.Timestamptz(6)

  documents    Document[]
  auditLogs    AuditLog[]
  permissions  DocumentPermission[]

  @@index([email])
}

model Document {
  id                      String             @id @default(uuid()) @db.Uuid
  ownerId                 String             @db.Uuid
  title                   String             @db.VarChar(255)
  description             String?            @db.Text
  visibility              DocumentVisibility @default(PRIVATE)
  publishTitle            Boolean            @default(true)  // Decision Q8: configurable public title
  publishDescription      Boolean            @default(false) // Decision Q8: configurable public description
  originalFileName        String             @db.VarChar(255)
  mimeType                String             @db.VarChar(100)
  fileSize                BigInt             @db.BigInt
  storageKey              String             @unique @db.VarChar(512) // UUID-based private storage key
  sha256Hash              String             @db.Char(64) // Canonical 64 hex characters (32 bytes)
  hashAlgorithm           String             @default("SHA-256") @db.VarChar(32)
  registrationStatus      RegistrationStatus @default(UPLOADED)
  publicVerificationToken String?            @unique @db.VarChar(64) // Decision Q7: 256-bit unguessable token
  isDeleted               Boolean            @default(false)
  deletedAt               DateTime?          @db.Timestamptz(6)
  createdAt               DateTime           @default(now()) @db.Timestamptz(6)
  updatedAt               DateTime           @updatedAt @db.Timestamptz(6)

  owner                   User               @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  registrations           BlockchainRegistration[]
  auditLogs               AuditLog[]
  permissions             DocumentPermission[]
  txOperations            TransactionOperation[]

  @@index([ownerId])
  @@index([sha256Hash])
  @@index([ownerId, sha256Hash]) // Decision Q1: fast same-user deduplication lookup
  @@index([visibility])
  @@index([registrationStatus])
  @@index([publicVerificationToken])
}

model BlockchainRegistration {
  id              String       @id @default(uuid()) @db.Uuid
  documentId      String       @db.Uuid
  chainId         BigInt       @db.BigInt // 11155111 for Sepolia, 31337 for Hardhat
  contractAddress String       @db.Char(42) // 0x + 40 hex chars
  documentKey     String       @unique @db.Char(66) // 0x + 64 hex chars (bytes32 keccak256(documentId))
  documentHash    String       @db.Char(66) // 0x + 64 hex chars (bytes32 SHA-256)
  issuerAddress   String       @db.Char(42) // Relayer wallet address that broadcast the tx (NOT user identity)
  transactionHash String       @unique @db.Char(66)
  blockNumber     BigInt?      @db.BigInt
  status          TxStatus     @default(SUBMITTED)
  blockTimestamp  DateTime?    @db.Timestamptz(6)
  confirmations   Int          @default(0)
  registeredAt    DateTime     @default(now()) @db.Timestamptz(6)
  createdAt       DateTime     @default(now()) @db.Timestamptz(6)
  updatedAt       DateTime     @updatedAt @db.Timestamptz(6)

  document        Document     @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@index([transactionHash])
  @@index([documentHash])
  @@index([chainId, contractAddress])
}

model DocumentPermission {
  id            String    @id @default(uuid()) @db.Uuid
  documentId    String    @db.Uuid
  granteeUserId String    @db.Uuid
  permission    String    @default("VIEW") @db.VarChar(32) // VIEW, VERIFY
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  revokedAt     DateTime? @db.Timestamptz(6)

  document      Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  grantee       User      @relation(fields: [granteeUserId], references: [id], onDelete: Cascade)

  @@unique([documentId, granteeUserId])
  @@index([granteeUserId])
}

model AuditLog {
  id          String         @id @default(uuid()) @db.Uuid
  actorUserId String?        @db.Uuid // Nullable for public/anonymous actions
  documentId  String?        @db.Uuid // Nullable for global auth events
  eventType   AuditEventType
  result      String         @db.VarChar(32) // SUCCESS, FAILURE, MISMATCH
  requestId   String         @db.VarChar(64)
  ipHash      String?        @db.VarChar(64) // Salted hash of IP for privacy
  userAgent   String?        @db.VarChar(255)
  metadata    Json?          @db.JsonB // Strictly sanitized: NO secrets or file bytes
  createdAt   DateTime       @default(now()) @db.Timestamptz(6)

  actor       User?          @relation(fields: [actorUserId], references: [id], onDelete: SetNull)
  document    Document?      @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@index([actorUserId])
  @@index([eventType])
  @@index([createdAt])
}

model TransactionOperation {
  id              String    @id @default(uuid()) @db.Uuid
  documentId      String    @db.Uuid
  chainId         BigInt    @db.BigInt
  idempotencyKey  String    @unique @db.VarChar(128) // Decision Q4: prevents double submission
  txHash          String?   @unique @db.Char(66)
  nonce           Int?
  gasPriceGwei    Decimal?  @db.Decimal(18, 8)
  status          TxStatus  @default(PENDING)
  retryCount      Int       @default(0)
  maxRetries      Int       @default(3)
  lastError       String?   @db.Text
  createdAt       DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt       DateTime  @updatedAt @db.Timestamptz(6)

  document        Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@index([status])
  @@index([idempotencyKey])
}
```

---

## 3. Justification of Entities & Constraints

1. **`User`**: Core authentication boundary; passwords hashed via bcrypt.
2. **`Document`**: Metadata and lifecycle anchor; indexed on `(ownerId, sha256Hash)` to support instantaneous same-user deduplication (Decision Q1).
3. **`BlockchainRegistration`**: Authoritative record of confirmed or pending blockchain registration; separates the blockchain `issuerAddress` (relayer) from the user account.
4. **`DocumentPermission`**: Fine-grained authorization for sharing private documents between registered accounts.
5. **`AuditLog`**: Append-only log recording all lifecycle actions; immutable off-chain audit trail.
6. **`TransactionOperation`**: Separates transient blockchain broadcast attempts, nonces, and retries from the final confirmed registration, guaranteeing idempotent retries (Decision Q4 & Q6).

---

## 4. Solidity Smart Contract Storage Layout (`ProofVault.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofVault Data Structures
 */
contract ProofVaultStorage {
    struct DocumentRecord {
        bytes32 documentHash;   // Canonical SHA-256 digest of original document
        uint64 registeredAt;    // Block timestamp of registration
        address issuer;         // Address that submitted the registration (Relayer)
        bool exists;            // Existence flag
        bool isRevoked;         // Revocation flag
    }

    // documentKey (e.g. keccak256(bytes(documentId))) => DocumentRecord
    mapping(bytes32 => DocumentRecord) internal _documents;

    // Contract state metadata
    uint256 public totalDocumentsRegistered;
}
```
