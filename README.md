# ProofVault

## Blockchain-Based Document Integrity and Verification

**ProofVault** is a document integrity and verification platform designed to establish mathematically and immutably whether a digital document has remained unchanged after registration. It combines high-throughput backend services, relational database persistence, and smart contracts deployed to an EVM-compatible blockchain to explore a transparent, tamper-evident, and auditable approach to document integrity.

> **Project Status:** Under active development. Core smart contracts (Solidity) and backend services (Node.js/TypeScript/Prisma) are stabilized with **100% smart contract coverage (26/26 tests verified)** and **63 backend tests (9 unit tests verified standalone, 54 database and EVM integration tests verified in local staging baseline)**. Features, deployment status, and test results should be verified against the current repository before each release. Note: Passing tests establish functional conformance, not a third-party security audit.

---

## Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Objectives](#objectives)
- [Core Features](#core-features)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Smart Contract Development](#smart-contract-development)
- [Backend Development](#backend-development)
- [API Documentation](#api-documentation)
- [Document Verification Workflow](#document-verification-workflow)
- [Testing](#testing)
- [Security Considerations](#security-considerations)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Documentation Maintenance](#documentation-maintenance)
- [Contributing](#contributing)
- [License](#license)
- [Maintainer](#maintainer)

---

## Overview

Digital documents can easily be copied, modified, or distributed without an obvious visual indication that their contents have changed. A reliable verification process requires a method to compare a candidate document against a previously registered, tamper-proof reference.

ProofVault explores this challenge using cryptographic hashing (canonical SHA-256) combined with blockchain anchoring (EVM smart contracts):
1. Registers an integrity reference on-chain (a `bytes32` digest) associated with a unique document key.
2. Preserves application records, user ownership, and audit trails in PostgreSQL.
3. Later verifies whether a submitted document byte-for-byte matches the registered reference on-chain.

### Why ProofVault?

- **Integrity verification:** Deterministically detects whether a candidate document differs by even a single byte from its registered version.
- **Tamper-evident records:** Uses decentralized blockchain state to anchor document references, ensuring timestamps and proofs cannot be altered retroactively—even by database administrators.
- **Backend integration:** Connects application-level operations with database persistence, a transactional relayer, and smart contracts.
- **Verifiable workflows:** Validates registration, verification, visibility toggles, and on-chain revocation in a local development environment.
- **Privacy preservation:** Document contents are **never** placed on-chain or exposed publicly. Only cryptographic digests (`bytes32`) and UUID-based keys are broadcast.
- **Extensibility:** Provides a modular foundation for enterprise document management, auditable trails, and multi-tenant verification portals.

---

## Problem Statement

Traditional document verification systems depend heavily on centralized databases or single trusted organizations to attest to authenticity. If those reference records are silently altered, corrupted, or become unavailable, verification loses its integrity and independent auditability.

ProofVault investigates whether blockchain-backed records can strengthen the integrity-verification process by providing an immutable, publicly verifiable anchor.

> [!IMPORTANT]
> **Trust Boundary Notice:** Blockchain registration alone does not prove who originally authored a physical document, whether its contents are truthful, or whether the submitter had the legal right to possess it. ProofVault verifies **cryptographic integrity and non-tampering since the point of registration**, while identity and legal governance remain application- and user-level responsibilities.

---

## Objectives

1. **Develop a robust backend** for document lifecycle management, authentication, private storage, and cryptographic operations.
2. **Integrate a relational database** (PostgreSQL via Prisma ORM) for user accounts, document metadata, audit logs, and transaction coordination.
3. **Implement gas-optimized smart contracts** (`ProofVault.sol`) with strict access controls, 2-step ownership transfer, registrar roles, and event emissions.
4. **Support dual-path verification:** Authenticated private document verification and unauthenticated public verification via sanitized cryptographic tokens.
5. **Handle on-chain revocation** with caller verification, event logging, and state enforcement.
6. **Ensure resilient transaction execution** via a reconciliation worker, nonce locking, and failure recovery.
7. **Maintain technical documentation** and reproducible test baselines across all development stages.

---

## Core Features

The following matrix outlines ProofVault's core capabilities, verified against the current codebase and automated test suites:

| Capability | Purpose | Verification Status |
| :--- | :--- | :--- |
| **Document Registration** | Ingest files, generate canonical hashes, and register on-chain | **Verified** (`POST /api/v1/documents`, `document.service.ts`) |
| **Cryptographic Hashing** | Stream raw file bytes to canonical SHA-256 (`bytes32`) | **Verified** (`crypto.utils.ts`, `receipt-validation.test.ts`) |
| **Database Persistence** | Persist metadata, audit logs, and transaction operations | **Verified** (Prisma 5.17, PostgreSQL 16 schema) |
| **Blockchain Relayer** | Broadcast registration transactions with nonce management | **Verified** (`blockchain.service.ts`, `live-evm-integration.test.ts`) |
| **Self-Healing Reconciliation** | Detect stuck transactions, verify on-chain state, auto-heal | **Verified** (`reconciliation.worker.ts`, 13/13 test cases pass) |
| **Private Verification** | Authenticated users test files against their stored document proofs | **Verified** (`POST /api/v1/documents/:id/verify`) |
| **Public Verification** | Token-based verification portal without exposing private data | **Verified** (`GET/POST /api/v1/public/verify/:token`) |
| **On-Chain Revocation** | Invalidate a proof on-chain with reason logging | **Verified** (`ProofVault.sol:revokeDocument`, 26/26 tests) |
| **Error Handling & Audit** | Structured API error responses and immutable off-chain audit logs | **Verified** (`response.utils.ts`, `errorHandler.ts`, `AuditLog`) |
| **Local EVM Integration** | End-to-end integration between backend, DB, and Hardhat node | **Verified** (`live-evm-integration.test.ts`, 5/5 pass) |

---

## How It Works

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Client
    participant API as ProofVault Backend
    participant DB as PostgreSQL (Prisma)
    participant BC as ProofVault Smart Contract (EVM)

    Note over User,BC: Registration Flow
    User->>API: Upload Document (Multipart File + Metadata)
    API->>API: Compute Canonical SHA-256 Digest
    API->>DB: Store Document Metadata & Set Status UPLOADED
    API->>BC: Relayer calls registerDocument(documentKey, documentHash)
    BC-->>BC: Validate Registrar Role, Store Record & Emit Event
    API->>DB: Update Status to CONFIRMED_ON_CHAIN + Save Tx Receipt
    API-->>User: Return Document Details & Verification Token

    Note over User,BC: Verification Flow
    User->>API: Submit Candidate File (Private or Public Token)
    API->>API: Compute SHA-256 Digest in Memory (Never stored)
    API->>BC: Call verifyDocument(documentKey, candidateHash)
    BC-->>API: Return (isMatch, registeredAt, issuer, isRevoked, revokedAt)
    API-->>User: Verification Result (Match / Mismatch / Revoked)
```

### Verification Step-by-Step

1. **Ingestion & Pre-Processing:** The client submits a document via multipart HTTP upload.
2. **Cryptographic Fingerprinting:** The backend computes a canonical SHA-256 hash over the raw binary bytes.
3. **Database Staging:** A `Document` record and `TransactionOperation` are persisted in PostgreSQL with initial status `PENDING` / `UPLOADED`.
4. **Blockchain Anchoring:** The relayer service formats the `documentKey` (`keccak256(bytes(documentId))`) and submits `registerDocument(key, hash)` to the EVM network.
5. **Confirmation & Receipt:** Upon receiving required block confirmations (1 on Hardhat, 2 on Sepolia), the receipt is validated and saved to the database.
6. **Candidate Verification:** When a candidate file is submitted, it is hashed strictly in-memory. The backend queries the smart contract via `verifyDocument()`.
7. **Tamper Detection:** If even one byte was modified, the hashes differ, producing an unambiguous `isMatch: false` result. If the document was previously revoked, `isRevoked: true` is reported.

> [!NOTE]
> **Important Distinction:** A matching cryptographic hash proves that the submitted file matches the registered reference byte-for-byte. It does not establish the legal validity or authorship of the document.

---

## Architecture

ProofVault is developed across three decoupled architectural tiers:

```mermaid
flowchart TD
    Client["Client / API Consumer<br/>(Frontend or Automated Integration)"]
    Backend["ProofVault Backend (Node.js / Express / TypeScript)"]
    Database[("PostgreSQL 16 Database<br/>(Prisma ORM)")]
    Contract["ProofVault Smart Contract<br/>(Solidity 0.8.24)"]
    Chain["EVM Blockchain Network<br/>(Local Hardhat / Sepolia Testnet)"]

    Client -->|HTTPS / JSON / Multipart| Backend
    Backend -->|Prisma Client| Database
    Backend -->|Ethers.js v6 JSON-RPC| Contract
    Contract -->|State & Events| Chain
```

### Component Responsibilities

- **Backend (`proofvault-backend/`):**
  - Authenticates users with JWT tokens and bcrypt password hashing.
  - Ingests files and computes canonical SHA-256 hashes.
  - Enforces authorization and uniform error handling (preventing document enumeration).
  - Manages transaction nonces, blockchain broadcasting, and retry logic.
  - Runs the background `ReconciliationWorker` to heal stuck or dropped operations.
- **Database (`PostgreSQL 16` via `Prisma`):**
  - Stores user credentials, document metadata, storage keys, and visibility settings.
  - Maintains off-chain `AuditLog` events and transactional operation tracking (`TransactionOperation`).
- **Smart Contracts (`proofvault-blockchain/`):**
  - `ProofVault.sol`: Immutable registry mapping `documentKey => DocumentRecord`.
  - Enforces `Ownable2Step` security and `_authorizedRegistrars` permissions.
  - Emits `DocumentRegistered`, `DocumentRevoked`, and `RegistrarUpdated` events.
  - Provides gas-free read-only verification through `verifyDocument()`.
- **Blockchain Network:**
  - Hardhat Local Node (Chain ID `31337`) for fast, zero-cost deterministic testing.
  - Ethereum Sepolia Testnet (Chain ID `11155111`) for staged multi-node verification.

---

## Technology Stack

| Technology | Purpose | Verified Version |
| :--- | :--- | :--- |
| **Node.js** | Backend JavaScript runtime | `>=20.0.0` (Verified on `v25.2.1` & LTS) |
| **Express.js** | HTTP REST API framework | `^4.19.2` |
| **TypeScript** | Type safety across backend and blockchain scripts | `^5.5.4` |
| **Prisma** | Database schema modeling, migrations, and ORM | `^5.17.0` |
| **PostgreSQL** | Relational persistence engine | `16-alpine` via Docker Compose |
| **Solidity** | Smart contract development language | `0.8.24` |
| **Hardhat** | Smart contract development environment & local EVM | `^2.22.18` |
| **OpenZeppelin Contracts** | Secure smart contract standards (`Ownable2Step`) | `^5.0.2` |
| **Ethers.js** | Blockchain JSON-RPC client and wallet signing | `^6.13.4` |
| **Docker & Docker Compose** | Containerized database orchestration | Docker `29.7.2` / Compose v2 |
| **Mocha & Chai** | Automated test runners and assertion libraries | Mocha `^10.7.0`, Chai `^4.4.1` |

---

## Repository Structure

```
bitmob/
├── architecture/                     # System-wide Architecture SOPs
│   ├── README.md                     # SOP overview and index
│   ├── SOP_DOCUMENT_LIFECYCLE.md     # Document states, transitions, and storage rules
│   ├── SOP_SECURITY_AND_PRIVACY.md   # Data isolation, hashing, and token generation
│   └── SOP_TRANSACTION_RECONCILIATION.md # Relayer retry and reconciliation rules
├── docs/                             # Engineering Specifications & Verification Records
│   ├── API_CONTRACTS.md              # REST API endpoints, DTOs, and error codes
│   ├── ARCHITECTURE.md               # Decoupled 3-tier architecture blueprint
│   ├── BLOCKCHAIN_DESIGN.md          # Smart contract design, gas profile, and ABI
│   ├── CONNECTIVITY_REPORT.md        # Environment and connectivity diagnostics
│   ├── DATA_SCHEMA.md                # Prisma database schema documentation
│   ├── DECISIONS.md                  # Architecture Decision Records (ADRs)
│   ├── DEVELOPMENT_SETUP.md          # Verified local environment setup instructions
│   ├── PHASE_3A_ARCHITECTURE_REVIEW.md# 4-stage implementation plan and audit
│   ├── REQUIREMENTS.md               # Functional & non-functional requirements
│   ├── TEST_STRATEGY.md              # Testing strategy, suites, and test cases
│   ├── THREAT_MODEL.md               # Security threat model and attack surface review
│   └── VERIFICATION_REPORT.md        # Test execution report and bug remediation record
├── proofvault-backend/               # Node.js / Express / TypeScript API Service
│   ├── prisma/                       # Database schema and migration history
│   │   ├── migrations/               # SQL migration scripts
│   │   └── schema.prisma             # Primary Prisma schema
│   ├── src/                          # Application source code
│   │   ├── config/                   # Configuration loaders and environment validation
│   │   ├── controllers/              # Route controllers
│   │   ├── db/                       # Prisma client singleton
│   │   ├── middleware/               # Auth, upload, and error middlewares
│   │   ├── routes/                   # Express routes (auth, documents, public)
│   │   ├── services/                 # Business logic (auth, document, blockchain, relayer)
│   │   ├── types/                    # TypeScript interfaces and DTOs
│   │   ├── utils/                    # Crypto, response, and logging utilities
│   │   ├── workers/                  # Background ReconciliationWorker
│   │   ├── app.ts                    # Express application builder
│   │   └── server.ts                 # Server entry point
│   ├── test/                         # Backend automated test suites (63 tests)
│   └── package.json                  # Backend dependencies and package scripts
├── proofvault-blockchain/            # Solidity / Hardhat Smart Contract Package
│   ├── contracts/                    # Solidity smart contracts
│   │   ├── interfaces/IProofVault.sol# Contract interface definition
│   │   └── ProofVault.sol            # Core registry implementation (Solidity 0.8.24)
│   ├── scripts/                      # Deployment and utility scripts
│   │   └── deploy.ts                 # Local and testnet deployment script
│   ├── test/                         # Hardhat contract test suite (26 tests)
│   ├── hardhat.config.ts             # Hardhat network and compiler configuration
│   └── package.json                  # Blockchain dependencies and package scripts
├── tools/                            # Standalone Diagnostic Utilities
│   ├── check_connectivity.py         # Zero-dependency Python environment health check
│   └── README.md                     # Diagnostic tools documentation
├── temp/                             # Ephemeral storage directory (.gitignored)
├── .dockerignore                     # Docker build exclusions
├── .env.example                      # Sanitized environment configuration template
├── .gitignore                        # Git repository exclusions
├── docker-compose.yml                # PostgreSQL 16 container definition
├── gemini.md                         # Master blueprint and system map
└── README.md                         # Root project documentation
```

---

## Prerequisites

Before setting up ProofVault, verify that your development environment meets the following requirements:

- **Git:** `>=2.30.0`
- **Node.js:** `>=20.0.0` (LTS recommended)
- **npm:** `>=10.0.0`
- **Docker Desktop / Docker Engine:** `>=24.0.0` with Docker Compose v2
- **Python (Optional):** `>=3.8` (required only for running `tools/check_connectivity.py`)

---

## Getting Started

Follow these steps to initialize and run the complete ProofVault stack locally:

### 1. Clone the Repository

```bash
git clone https://github.com/vinayaksiddhi/ProofVault.git
cd ProofVault
```

### 2. Configure Environment Variables

Copy the provided sanitized template to `.env`:

```bash
cp .env.example .env
```

Review `.env` and configure appropriate development values. *(Default values in `.env.example` work out-of-the-box for local development with Hardhat and Docker).*

### 3. Start the PostgreSQL Database

Launch the persistent PostgreSQL 16 container using Docker Compose:

```bash
docker compose up -d
docker compose ps
```

Verify that the `proofvault-postgres` container is running and healthy on port `5432`.

### 4. Install Dependencies

Install dependencies in both the backend and blockchain packages:

```bash
# Install blockchain dependencies
cd proofvault-blockchain
npm ci

# Install backend dependencies
cd ../proofvault-backend
npm ci
```

### 5. Compile and Test Smart Contracts

From `proofvault-blockchain/`:

```bash
# Compile contracts
npm run compile

# Run automated contract test suite (26 tests)
npm test

# Generate test coverage report (100% target)
npm run coverage
```

### 6. Start Local Blockchain and Deploy Contract

Open a new terminal window to run the local Hardhat EVM node:

```bash
cd proofvault-blockchain
npm run node
```

In your primary terminal, deploy the contract to the running local node:

```bash
cd proofvault-blockchain
npm run deploy:local
```

Copy the printed contract address (typically `0x5FbDB2315678afecb367f032d93F642f64180aa3`) and update `CONTRACT_ADDRESS` in your root `.env` file.

### 7. Run Database Migrations

Generate the Prisma client and apply migrations from `proofvault-backend/`:

```bash
cd proofvault-backend
npm run prisma:generate
npm run prisma:deploy
```

### 8. Start the Backend API Server

```bash
cd proofvault-backend
npm run dev
```

The API server will listen on `http://127.0.0.1:4000`. You can verify health via:

```bash
curl http://127.0.0.1:4000/api/v1/health
```

---

## Environment Configuration

Configuration is managed via environment variables defined in `.env` (derived from `.env.example`):

| Variable | Description | Required? | Default / Example |
| :--- | :--- | :---: | :--- |
| `NODE_ENV` | Application runtime environment | No | `development` |
| `PORT` | HTTP port for backend listener | No | `4000` |
| `DATABASE_URL` | PostgreSQL connection string | **Yes** | `postgresql://user:pass@127.0.0.1:5432/proofvault_db` |
| `POSTGRES_USER` | Docker PostgreSQL username | **Yes** | `proofvault_user` |
| `POSTGRES_PASSWORD`| Docker PostgreSQL password | **Yes** | `proofvault_password` |
| `POSTGRES_DB` | Docker PostgreSQL database name | **Yes** | `proofvault_db` |
| `JWT_SECRET` | Secret key for signing access tokens | **Yes** | 64-char random hex |
| `JWT_EXPIRES_IN` | Access token lifespan | No | `15m` |
| `REFRESH_TOKEN_SECRET`| Secret key for refresh tokens | **Yes** | 64-char random hex |
| `CHAIN_ID` | EVM network chain identifier | **Yes** | `31337` (Hardhat) / `11155111` (Sepolia) |
| `RPC_URL` | Blockchain JSON-RPC provider endpoint | **Yes** | `http://127.0.0.1:8545` |
| `CONTRACT_ADDRESS`| Deployed `ProofVault` contract address | **Yes** | `0x5FbDB...` |
| `RELAYER_PRIVATE_KEY`| Private key for transaction relayer | **Yes** | Hardhat account `#0` for local dev |
| `CONFIRMATION_THRESHOLD_HARDHAT` | Required confirmations for Hardhat | No | `1` |
| `CONFIRMATION_THRESHOLD_SEPOLIA` | Required confirmations for Sepolia | No | `2` |
| `STORAGE_DRIVER` | File storage driver (`local` or `s3`) | No | `local` |
| `LOCAL_STORAGE_PATH`| Directory for encrypted file storage | No | `./temp/storage` |
| `MAX_FILE_SIZE_BYTES`| Maximum allowed file size | No | `26214400` (25 MB) |

### Security Rules

- **Never** commit `.env` or `.env.local` to version control.
- **Never** place real private keys with mainnet funds in environment files.
- Keep `.env.example` sanitized with safe placeholder values only.
- Local development private keys provided by Hardhat must **only** be used on local networks.

---

## Database Setup

ProofVault uses **PostgreSQL 16** with **Prisma ORM**. The schema is defined in [schema.prisma](proofvault-backend/prisma/schema.prisma) and documented in detail in [DATA_SCHEMA.md](docs/DATA_SCHEMA.md).

### Core Data Models

- **`User`**: Account identity, email, bcrypt password hash, role (`USER` / `ADMIN`), and account status.
- **`Document`**: Document metadata, file size, MIME type, storage key, SHA-256 hash, visibility (`PRIVATE` / `PUBLIC_VERIFIABLE`), and registration status.
- **`BlockchainRegistration`**: Immutable record of confirmed on-chain registrations, linking document IDs to transaction hashes, block numbers, and gas used.
- **`TransactionOperation`**: Relayer coordination table tracking transactional state machines (`PENDING`, `SUBMITTED`, `CONFIRMED`, `FAILED`, `REPLACED`) with retry counters.
- **`AuditLog`**: Append-only log recording all security and lifecycle events (`DOCUMENT_UPLOADED`, `BLOCKCHAIN_CONFIRMED`, `BLOCKCHAIN_REVOKED`, etc.).
- **`DocumentPermission`**: Granular access control for shared private documents.
- **`RefreshToken`**: Cryptographically hashed session tokens with expiration tracking.

### Migration Management

```bash
# Apply pending migrations to local database
npm run prisma:deploy

# Inspect current migration status
npm run prisma:status

# Regenerate Prisma Client after schema edits
npm run prisma:generate
```

> [!CAUTION]
> Do not execute `prisma migrate reset` in environments where persisted database records must be preserved.

---

## Smart Contract Development

The smart contract layer is located in `proofvault-blockchain/` and uses **Solidity 0.8.24** and **Hardhat**.

### Contract: `ProofVault.sol`

The core contract implements [IProofVault.sol](proofvault-blockchain/contracts/interfaces/IProofVault.sol) and inherits OpenZeppelin's `Ownable2Step`:

- **`registerDocument(bytes32 documentKey, bytes32 documentHash)`**: Anchors a document hash. Restricted to authorized registrars (the backend relayer) or the contract owner.
- **`revokeDocument(bytes32 documentKey, string calldata reason)`**: Marks a document proof as revoked. Can only be invoked by the original issuer or contract owner.
- **`verifyDocument(bytes32 documentKey, bytes32 candidateHash)`**: Pure view function returning `(bool isMatch, uint64 registeredAt, address issuer, bool isRevoked, uint64 revokedAt)`.
- **`getDocument(bytes32 documentKey)`**: Direct record lookup returning the stored `DocumentRecord`.
- **`setRegistrar(address registrar, bool authorized)`**: Grants or revokes registrar permissions (owner only).

### Development Scripts

```bash
cd proofvault-blockchain

# Compile Solidity source files
npm run compile

# Run Hardhat test suite
npm test

# Run code coverage check
npm run coverage

# Start local JSON-RPC EVM node
npm run node

# Deploy to local node
npm run deploy:local
```

---

## Backend Development

The backend is built with **Express.js** and **TypeScript** adhering to a layered architecture:

- **Entry Point (`src/server.ts`):** Validates environment variables, tests database and blockchain connectivity, and starts HTTP listener.
- **Router Layer (`src/routes/`):** Mounts sub-routers at `/api/v1/auth`, `/api/v1/documents`, and `/api/v1/public`.
- **Middleware (`src/middleware/`):** JWT verification (`auth.middleware.ts`), file streaming limiters (`upload.middleware.ts`), and global error handling (`errorHandler.ts`).
- **Service Layer (`src/services/`):**
  - `document.service.ts`: File ingestion, canonical hashing, duplicate detection, and deletion.
  - `blockchain.service.ts`: Ethers v6 contract interaction, relayer nonce mutex, and receipt validation.
  - `auth.service.ts`: User registration, authentication, and JWT lifecycle.
- **Reconciliation Worker (`src/workers/reconciliation.worker.ts`):** Background cron worker that audits pending transaction operations, queries on-chain receipts, and resolves stalled operations.

---

## API Documentation

All API responses follow a uniform JSON structure:

```json
{
  "success": true,
  "data": { ... },
  "meta": { "timestamp": "2026-10-30T09:00:00.000Z" }
}
```

### Endpoints Specification

| Method | Endpoint | Auth | Purpose | Success Code |
| :--- | :--- | :---: | :--- | :---: |
| `GET` | `/api/v1/health` | None | Service, database, and blockchain health status | `200` |
| `POST` | `/api/v1/auth/register` | None | Register new user account with email and password | `201` |
| `POST` | `/api/v1/auth/login` | None | Authenticate user and receive access & refresh tokens | `200` |
| `POST` | `/api/v1/documents` | Bearer | Multipart upload, canonical hashing, and registration | `201` / `200` |
| `GET` | `/api/v1/documents` | Bearer | List documents owned by authenticated user | `200` |
| `GET` | `/api/v1/documents/:id` | Bearer | Get document metadata (uniform 404 for unauthorized) | `200` |
| `PATCH` | `/api/v1/documents/:id/visibility` | Bearer | Toggle visibility (`PRIVATE` / `PUBLIC_VERIFIABLE`) | `200` |
| `DELETE` | `/api/v1/documents/:id` | Bearer | Soft-delete metadata and purge encrypted file bytes | `200` |
| `POST` | `/api/v1/documents/:id/revoke` | Bearer | Revoke registered document on-chain | `200` |
| `POST` | `/api/v1/documents/:id/verify` | Bearer | Private verification against on-chain hash | `200` |
| `POST` | `/api/v1/documents/:id/register-on-chain` | Bearer | Manually trigger or retry on-chain registration | `200` |
| `GET` | `/api/v1/documents/:id/chain-status` | Bearer | Retrieve blockchain transaction history and status | `200` |
| `GET` | `/api/v1/public/verify/:token` | None | Public metadata lookup for verifiable document | `200` |
| `POST` | `/api/v1/public/verify/:token/check` | None | In-memory verification of uploaded candidate file | `200` |

For complete request/response schemas, DTOs, and error codes, refer to [API_CONTRACTS.md](docs/API_CONTRACTS.md).

---

## Document Verification Workflow

The verification workflow guarantees byte-level integrity verification:

```
[Candidate File Uploaded]
          │
          ▼
[Compute SHA-256 Digest in Memory]
          │
          ▼
[Query Smart Contract: verifyDocument(key, candidateHash)]
          │
     ┌────┴──────────────────────────┐
     ▼                               ▼
[Hash Match & Not Revoked]    [Hash Mismatch OR Revoked]
     │                               │
     ▼                               ▼
  VALID (Integrity Confirmed)     INVALID / TAMPERED / REVOKED
```

### Covered Test Scenarios

- **Exact Document Match:** Uploading the exact file produces `isMatch: true` and confirms registration timestamp.
- **Single-Byte Modification:** Changing even 1 byte in a document alters the SHA-256 digest, resulting in `isMatch: false`.
- **Revoked Document:** A document revoked on-chain returns `isMatch: false` with `isRevoked: true` and `revokedAt > 0`.
- **Unknown Document Key:** Non-existent keys safely return `isMatch: false` without reverting.
- **Sanitized Public Verification:** Public verification never exposes original file contents, owner IDs, or storage paths.

---

## Testing

ProofVault maintains a comprehensive automated testing suite across both codebases:

### Test Execution Commands

```bash
# 1. Smart Contract Test Suite (26 tests)
cd proofvault-blockchain
npm test

# 2. Smart Contract Coverage (100% statement, branch, function, line coverage)
npm run coverage

# 3. Backend Unit Tests (Receipt validation, response formatters)
cd ../proofvault-backend
npm run test:unit

# 4. Backend Database Tests (Auth, CRUD, lifecycle, reconciliation)
npm run test:db

# 5. Live Local EVM Integration Tests (End-to-end blockchain relayer)
npm run test:integration

# 6. Complete Backend Test Suite (63 tests)
npm test
```

### Verified Test Results

| Test Suite | Location | Tests | Status |
| :--- | :--- | :---: | :---: |
| **Smart Contract Unit Tests** | `proofvault-blockchain/test/ProofVault.test.ts` | 26 | **PASS (100%)** |
| **Receipt Validation Unit** | `proofvault-backend/test/receipt-validation.test.ts` | 9 | **PASS** |
| **Database & Auth Integration** | `proofvault-backend/test/auth.test.ts` | 6 | **PASS** |
| **Database Connectivity** | `proofvault-backend/test/db-connectivity.test.ts` | 4 | **PASS** |
| **Document Ingestion** | `proofvault-backend/test/document-ingestion.test.ts` | 8 | **PASS** |
| **Document Lifecycle** | `proofvault-backend/test/document-lifecycle.test.ts` | 8 | **PASS** |
| **Coordination & Nonce Locks** | `proofvault-backend/test/coordination.test.ts` | 5 | **PASS** |
| **Blockchain Relayer Service** | `proofvault-backend/test/blockchain-integration.test.ts` | 5 | **PASS** |
| **Reconciliation Worker** | `proofvault-backend/test/reconciliation-worker.test.ts` | 13 | **PASS** |
| **Live Local EVM End-to-End** | `proofvault-backend/test/live-evm-integration.test.ts` | 5 | **PASS** |
| **Total Test Coverage** | **All suites combined** | **89** | **ALL PASS** |

For the complete verification audit, see [VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md).

---

## Security Considerations

ProofVault enforces defense-in-depth principles across all components:

1. **Private Key Isolation:** The backend relayer private key is loaded exclusively through environment variables. Keys are never logged or stored in the database.
2. **Access Control & Ownership:** The smart contract implements OpenZeppelin's `Ownable2Step` to prevent accidental ownership loss. Only authorized registrars can register hashes.
3. **No Sensitive Data On-Chain:** Only cryptographic digests (`bytes32`) and derived keys are written to the blockchain. Original files and personally identifiable information (PII) remain strictly off-chain.
4. **In-Memory Verification:** Candidate files uploaded for verification are streamed and hashed in volatile memory, then discarded immediately without touching disk.
5. **Nonce Mutex & Concurrency:** The relayer service incorporates an in-memory mutex to prevent nonce collisions during rapid transaction submissions.
6. **Uniform Enumeration Protection:** Requesting unauthorized document IDs returns uniform HTTP `404 Not Found` responses to prevent ID enumeration.
7. **Storage File Purging:** Deleting a document triggers immediate cryptographic shredding / unlinking of the underlying storage file on disk.

For the threat model and risk assessment, consult [THREAT_MODEL.md](docs/THREAT_MODEL.md).

---

## Known Limitations

- **Frontend Interface:** A full React/Vite web interface is currently in scaffolding (Stage 4). All functionality is currently accessible via the REST API and CLI.
- **Identity & Authorship:** On-chain registration guarantees that a document existed in an exact state at a given time; it does not prove legal authorship or truthfulness of content.
- **Local Relayer:** In local development, the relayer submits transactions from a funded Hardhat test account. Production deployment requires gas management and monitoring.
- **Single Target Network:** The backend is configured to interact with one EVM network at a time (configured via `CHAIN_ID` and `RPC_URL`).

---

## Roadmap

- [x] **Stage 1: Smart Contract Layer** (Solidity 0.8.24, Hardhat, 100% test coverage)
- [x] **Stage 2: Database & Core API** (PostgreSQL 16, Prisma schema, Auth, Ingestion)
- [x] **Stage 3: Blockchain Relayer & Reconciliation** (Ethers v6 relayer, nonce management, auto-healing worker)
- [ ] **Stage 4: Frontend Application** (React 18 + Vite + Tailwind CSS document dashboard and public verification portal)
- [ ] **Stage 5: Testnet Staging & Deployment** (Automated deployment to Ethereum Sepolia testnet)
- [ ] **Stage 6: PDF Verification Certificate Exporter** (Cryptographically signed downloadable audit reports)
- [ ] **Stage 7: Multi-Tenant Enterprise Permissions** (Team workspaces and role-based access control)

---

## Documentation Maintenance

Documentation is treated as a first-class engineering artifact:

- Any code change modifying API routes, Prisma schemas, smart contract interfaces, or configuration requires a corresponding update in `docs/`.
- Test counts and coverage figures in `README.md` and `VERIFICATION_REPORT.md` must only be updated following clean, verified test runs.
- Architectural decisions must be documented in [DECISIONS.md](docs/DECISIONS.md).

---

## Contributing

1. Review [DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md) for local configuration.
2. Create a feature branch: `git checkout -b feature/your-feature-name`.
3. Follow repository conventions and maintain strict TypeScript types.
4. Add automated tests covering any new functionality or edge cases.
5. Ensure all test suites pass: `npm test` in both `proofvault-blockchain` and `proofvault-backend`.
6. Submit a pull request with detailed verification evidence.

---

## License

This project's license is pending maintainer designation. All rights reserved until officially licensed.

---

## Maintainer

- **Maintainer:** Vinayak Siddhi
- **GitHub:** [@vinayaksiddhi](https://github.com/vinayaksiddhi)
- **Repository:** [ProofVault](https://github.com/vinayaksiddhi/ProofVault)

For architecture blueprints, database schemas, API specifications, and testing strategies, explore the [docs/](docs/) directory.
