# ProofVault — System Architecture & Three-Codebase Structure
**Document ID:** PV-ARCH-001  
**Status:** PHASE 1 BLUEPRINT REVIEW (Updated & Finalized)  
**Last Updated:** 2026-10-11  

---

## 1. System Topology Overview

ProofVault is structured as a decoupled, multi-tier system with distinct failure domains and strict boundary enforcement across three independent repositories:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT TIER                                    │
│  [proofvault-frontend]                                                       │
│  • React 18 / Vite / TypeScript / Tailwind CSS / Lucide Icons              │
│  • Browser file preview & client-side informational pre-hashing             │
│  • QR-code renderer & PDF verification report exporter                      │
│  • Honest UI state machines (pending, submitted, confirmed, failed)        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS / JSON / Multipart
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            APPLICATION TIER                                 │
│  [proofvault-backend]                                                       │
│  • Node.js 20+ / Express / TypeScript / Prisma ORM                          │
│  • Auth Service (JWT Bearer tokens & bcrypt hashing)                        │
│  • Streaming File Ingestion & Canonical SHA-256 Hashing Engine              │
│  • Private File Storage Provider (Encrypted local disk in dev / S3 in prod) │
│  • Blockchain Relayer Service (ethers.js v6, Sepolia relayer wallet)        │
│  • Idempotency & Bounded Retry Engine (Nonce locks, gas bump management)    │
│  • Self-Healing Reconciliation Worker (Recovers dropped DB writes / reorgs) │
│  • Verification Service (Database + Smart contract cross-check)             │
│  • PDF Report Generation Service                                            │
└──────────────┬───────────────────────────────┬──────────────────────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐ ┌────────────────────────────────────────────┐
│      PERSISTENCE TIER        │ │             BLOCKCHAIN TIER                │
│  • PostgreSQL 16             │ │  [proofvault-blockchain]                   │
│    - User Accounts & Roles   │ │  • Solidity 0.8.24 Smart Contracts         │
│    - Document Metadata & ACL │ │  • Hardhat Development Network (local)     │
│    - Blockchain Tx Receipts  │ │  • Ethereum Sepolia Testnet (public)       │
│    - Off-Chain Audit Trail   │ │  • Deployed Contract: ProofVault.sol       │
│    - Tx Operations & Nonces  │ │  • Key-Value Registry:                     │
│  • Private File Storage      │ │    documentKey => DocumentRecord           │
│    - Isolated Disk/S3 Bucket │ │  • Emits: DocumentRegistered,              │
│    - Unguessable storage keys│ │           DocumentRevoked                  │
└──────────────────────────────┘ └────────────────────────────────────────────┘
```

---

## 2. Three Codebase Boundary Specifications

### 2.1 `proofvault-frontend/`
- **Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS, React Router v6, Lucide React, ethers.js v6, jsPDF, qrcode.react.
- **Independence:** Own `package.json`, `tsconfig.json`, `tailwind.config.js`, `.env`. Zero runtime dependencies on backend source code.
- **Responsibilities:**
  - Responsive landing presentation, user authentication forms, interactive dashboard.
  - Multi-part drag-and-drop file upload with MIME-type and size checking.
  - Verification studio: Private verification for owners; public verification portal for third parties.
  - Transaction state visualization: Honest loaders showing exact blockchain mempool status and confirmation counts.
  - Client-side report viewer and PDF exporter.
- **Trust Boundary:** The frontend is untrusted. It can never declare a transaction confirmed without backend or on-chain verification. It never receives or stores backend private keys.

### 2.2 `proofvault-backend/`
- **Tech Stack:** Node.js 20+, Express, TypeScript, Prisma ORM, PostgreSQL, ethers.js v6, multer, cors, helmet, zod, pino.
- **Independence:** Own `package.json`, `tsconfig.json`, `prisma/schema.prisma`, `.env`.
- **Responsibilities:**
  - **Canonical Byte Hashing:** Reads uploaded file stream, calculates canonical SHA-256 digest, stores file privately.
  - **Deduplication Check:** Prevents duplicate uploads for the same user while preserving privacy across different users.
  - **Relayer Wallet Management:** Manages transaction sequencing, nonces, gas limits, and broadcasting to Ethereum Sepolia / Hardhat.
  - **Idempotency & Retries:** Pre-checks contract state via view calls before retrying; applies bounded exponential backoff.
  - **Self-Healing Reconciliation:** Background worker that polls pending transactions, detects reorganizations or dropped transactions, and reconciles database status with blockchain receipts.
- **Trust Boundary:** Authoritative for application business logic, authorization, and canonical file hashing. Must treat all client requests as untrusted.

### 2.3 `proofvault-blockchain/`
- **Tech Stack:** Solidity `^0.8.24`, Hardhat, OpenZeppelin Contracts v5, TypeScript, ethers.js v6, hardhat-gas-reporter.
- **Independence:** Own `package.json`, `hardhat.config.ts`, `contracts/`, `test/`, `scripts/`.
- **Responsibilities:**
  - Implements `ProofVault.sol` contract.
  - Stores immutable registration mapping: `documentKey => DocumentRecord`.
  - Emits indexed events: `DocumentRegistered`, `DocumentRevoked`.
  - Provides gas-optimized read functions for verification.
  - Complete automated test suite covering success paths, duplicate rejections, access control, and gas benchmarks.
- **Trust Boundary:** Authoritative source for on-chain existence and registration timestamp. Does not store files, identities, or personal data. The `issuer` recorded on-chain is the transaction sender address (relayer wallet), not the off-chain user identity.

---

## 3. A.N.T. Three-Layer Architecture Mapping

| A.N.T. Layer | ProofVault Implementation | Location |
| :--- | :--- | :--- |
| **Layer 1: Architecture (SOPs)** | Technical SOPs in Markdown specifying objectives, schemas, edge cases, retry logic, and validation rules before any code is built. | `architecture/` & `docs/` |
| **Layer 2: Navigation (Orchestration)** | Application control plane, business logic controllers, API route dispatchers, and state machine transitions. | `proofvault-backend/src/services/` |
| **Layer 3: Tools (Deterministic Engines)** | Atomic, testable execution units: Hash calculation script, contract caller, PDF generator, database repository methods. | `proofvault-backend/src/tools/` & `tools/` |

---

## 4. Blockchain Integration Pattern: Relayer vs. Client Signer

To provide a seamless user experience while supporting decentralized guarantees, ProofVault adopts a **Hybrid Relayer Model**:

1. **MVP Mode (Backend Relayer):**
   - The user uploads a file and requests blockchain anchoring.
   - The backend signs and broadcasts the registration transaction using an application-managed relayer wallet.
   - Gas fees on testnet are subsidized by the platform relayer.
   - Ideal for non-crypto-native users, enterprise workflows, and automated systems.

2. **Decentralized Mode (Future Extension - Deferred from MVP):**
   - The user connects MetaMask or an injected EIP-1193 wallet.
   - The backend generates the exact `documentKey` and `documentHash` payload and returns it to the frontend.
   - The user's wallet signs and directly executes the `registerDocument` transaction on Sepolia.
   - The user submits the transaction hash back to the backend for verification and indexing.

---

## 5. Transaction Reconciliation & Self-Healing Worker

Because blockchain transactions are asynchronous and subject to mempool delays, gas fluctuations, and potential reorgs:

1. **Submission:** Upon broadcast, backend creates a `TransactionOperation` row with status `SUBMITTED`, records `nonce` and `txHash`.
2. **Reconciliation Worker:** A background poller runs every 60 seconds:
   - Queries `provider.getTransactionReceipt(txHash)`.
   - If receipt exists with status `1` (Success) and confirmations >= `CONFIRMATION_THRESHOLD`:
     - Updates `BlockchainRegistration` to `CONFIRMED`.
     - Updates `Document` status to `CONFIRMED_ON_CHAIN`.
     - Logs `AuditLog` event `BLOCKCHAIN_CONFIRMED`.
   - If receipt exists with status `0` (Reverted):
     - Updates status to `FAILED`.
     - Logs error reason.
   - If pending > 10 minutes:
     - Pre-checks contract state: calls `getDocument(documentKey)` on-chain. If already registered, marks `CONFIRMED_ON_CHAIN`.
     - If not registered, performs bounded replacement transaction (up to 3 retries, bumping gas by 15%).
     - If retries exhausted, marks status `STALLED_NEEDS_RECONCILIATION` and alerts operator without dropping data.
