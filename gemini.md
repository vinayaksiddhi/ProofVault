# PROOFVAULT — PROJECT MAP & MASTER BLUEPRINT
**System Identity:** Antigravity System Architect & Technical Project Planner  
**Protocol:** B.L.A.S.T. (Blueprint, Link, Architect, Stylize, Trigger)  
**Architecture:** A.N.T. 3-Layer System (Layer 1: Architecture SOPs, Layer 2: Navigation & Orchestration, Layer 3: Deterministic Tools)  
**Current Phase:** Phase 3B: Stage 3 — Blockchain Relayer & Reconciliation Worker (Complete & Verified)  
**Execution Status:** 🔒 **HALTED / EXECUTION LOCKED** (Stage 3 Complete; Awaiting Human Approval for Stage 4: Frontend Scaffolding)  
**Last Updated:** 2026-10-14  

---

## 1. Project Identity & Objective

- **Project Name:** ProofVault
- **Category:** Full-stack Web3, blockchain document integrity, cryptographic verification, and auditable evidence management.
- **Primary Objective:** Build a deterministic, modular, production-grade platform allowing users to securely upload digital documents, compute canonical SHA-256 cryptographic fingerprints, anchor them immutably on an EVM blockchain (Ethereum Sepolia testnet / Local Hardhat), track full audit history, and permit authorized or public tamper-evident verification with downloadable PDF evidence reports.
- **Repository Architecture:** Three decoupled, independently maintainable codebases:
  1. `proofvault-frontend/` (React + Vite + TypeScript + Tailwind CSS + ethers.js)
  2. `proofvault-backend/` (Node.js + Express + TypeScript + PostgreSQL + Prisma + ethers.js)
  3. `proofvault-blockchain/` (Solidity 0.8.24 + Hardhat + OpenZeppelin 5 + ethers.js v6) — **STAGE 1 COMPLETE**
- **Root Control Artifacts:**
  - `gemini.md`: Master project map, data contracts, and source of truth
  - `proofvault-blockchain/`: Working, locally tested smart contract layer with 100% test coverage
  - `architecture/`: Layer 1 SOPs (`SOP_DOCUMENT_LIFECYCLE.md`, `SOP_TRANSACTION_RECONCILIATION.md`, `SOP_SECURITY_AND_PRIVACY.md`)
  - `docs/PHASE_3A_ARCHITECTURE_REVIEW.md`: Staged 4-stage implementation plan
  - `docs/BLOCKCHAIN_DESIGN.md`: Smart contract interface and verification evidence
  - `docker-compose.yml`: Localhost-only PostgreSQL 16 container with named volume
  - `.gitignore` & `.dockerignore`: Protection of secrets and local artifacts
  - `.env.example` & `.env`: Environment templates and untracked development credentials
  - `tools/check_connectivity.py`: Layer 3 diagnostic tool

---

## 2. Core USPs & Value Proposition

| Unique Selling Proposition | Implementation Strategy | Trust & Authority Boundaries |
| :--- | :--- | :--- |
| **USP 1: Tamper-Evident Verification** | Server computes canonical SHA-256 hash over raw file bytes. Smart contract anchors hash in `bytes32`. Re-uploaded files recomputed byte-for-byte. | Blockchain is authoritative for registered hash and timestamp. Files are never stored on-chain. |
| **USP 2: Auditable Document History** | Lifecycle transitions (registration, visibility changes, verification attempts) logged to PostgreSQL `AuditLog`. On-chain state emit smart-contract events. | Database audit logs are explicitly marked off-chain and not claimed to be immutable. On-chain events provide immutable cryptographic timestamps. |
| **USP 3: Independent Public Verification** | Opt-in public verification URLs and QR codes. Third parties verify document integrity without an account. Downloadable verification PDF reports. | Public verification exposes zero personal data, original files, or private storage paths. Only public metadata, hash matching, and blockchain receipts are shared. |

---

## 3. Data Ownership & Trust Boundaries

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DATA OWNERSHIP BOUNDARIES                       │
├──────────────────────┬────────────────────────┬────────────────────────┤
│     PostgreSQL       │  Private File Storage  │  EVM Blockchain (Sepolia)
│  (Prisma ORM)        │  (Encrypted Disk/S3)   │  (ProofVault Contract) │
├──────────────────────┼────────────────────────┼────────────────────────┤
│ • User Accounts      │ • Original file bytes  │ • Document Hash        │
│ • Document Metadata  │ • Ephemeral uploads    │   (bytes32 SHA-256)    │
│ • File Storage Keys  │ • Verification caches  │ • Document Key         │
│ • Visibility & ACLs  │                        │   (bytes32 UUID hash)  │
│ • Off-chain Audit Log│                        │ • Registered Timestamp │
│ • Tx Operations      │                        │ • Issuer Address       │
│ • Report Metadata    │                        │   (Relayer Wallet)     │
└──────────────────────┴────────────────────────┴────────────────────────┘
```

---

## 4. Master Transaction & Lifecycle State Machine

```
   [Upload File]
         │
         ▼
    (Uploaded) ───[Compute SHA-256 & Store File]
         │
         ▼
   (Hash Computed) ───[Pre-Flight Contract Read]
         │                     │
         │                     ├───(Already Registered?) ───> [CONFIRMED_ON_CHAIN]
         ▼
     [SUBMITTED] ───(Tx Hash Logged, Block Pending)
      │        │
      │        └───> [TIMEOUT / REORG] ───> [RETRY / RECONCILE]
      │                                             │
      ▼                                             ▼
 [CONFIRMED] (Receipt status 1, Event verified)  [FAILED] (Revert / Out of Gas)
```

---

## 5. B.L.A.S.T. Phase Tracking & Checklist

### Phase 1: Blueprint (Complete)
- [x] Protocol 0 initialized and execution locked
- [x] Core architecture and 3-codebase boundaries established
- [x] All 8 technical specifications created & synchronized in `docs/`
- [x] 10 Decisions finalized and locked in [`docs/DECISIONS.md`](file:///d:/Project/bitmob/docs/DECISIONS.md)

### Phase 2: Link / Phase 2A (Complete & Verified)
- [x] Environment inventory verified (Node.js `v25.2.1`, npm `11.6.2`, Docker `29.7.2`, Python `3.13.7`)
- [x] Docker Compose configured with PostgreSQL 16, persistent volume, and loopback binding `127.0.0.1:5432:5432`
- [x] Container launched & health status verified: `proofvault-postgres` is **Up (healthy)**
- [x] Engine version verified: `PostgreSQL 16.15 on x86_64-pc-linux-musl`
- [x] Dedicated database `proofvault_db` and user `proofvault_user` verified via `SELECT 1;` (`1` returned)
- [x] Remote Ethereum Sepolia Public RPC verified (Chain ID `11155111`, Block `11893294`)

### Phase 3A: Architect Review (Complete)
- [x] Layer 1 SOPs created in `architecture/`
- [x] Comprehensive review document created: [`docs/PHASE_3A_ARCHITECTURE_REVIEW.md`](file:///d:/Project/bitmob/docs/PHASE_3A_ARCHITECTURE_REVIEW.md)
- [x] Staged 4-stage implementation roadmap defined with acceptance criteria

### Phase 3B: Architect Implementation (Stage 1 Complete)
- [x] **Stage 1: `proofvault-blockchain/` Scaffolding & Verification**
  - [x] Hardhat project scaffolded with Solidity `0.8.24` and OpenZeppelin `5.0.2`
  - [x] `ProofVault.sol` contract implemented (Registration, Verification, Lookup, Revocation, Registrar ACL)
  - [x] 24/24 automated unit and security tests passing
  - [x] 100% code coverage achieved across statements, branches, functions, and lines
  - [x] Ephemeral local Hardhat deployment and read/write execution verified (`scripts/deploy.ts`)
- [x] **Stage 2: `proofvault-backend/` Core & Persistence (Complete & Verified)**
  - [x] Scaffolding Express + TypeScript codebase with strict types and security middlewares (Helmet, CORS, Request ID)
  - [x] Prisma schema with PostgreSQL models (including approved revocation fields on `BlockchainRegistration`)
  - [x] Database migration applied (`20261013141639_init_core_schema`) on persistent Docker PostgreSQL volume
  - [x] Auth Service (JWT Bearer tokens + bcrypt work factor 12 + complex password validation)
  - [x] Streaming file ingestion, magic-byte binary header inspection, and canonical SHA-256 hashing
  - [x] Isolated private disk storage (`temp/storage/doc_<uuid>.bin`) with zero public web exposure
  - [x] Same-user deduplication service (Decision Q1) and cross-user privacy isolation (Decision Q2)
  - [x] Document lifecycle operations: visibility toggle, sanitized public verification DTO, revocation, soft-deletion & byte purging
  - [x] 29/29 automated integration tests passing across DB, auth, upload validation, hashing, lifecycle, and secret redaction
- [ ] **Stage 3: Blockchain Relayer & Reconciliation Worker**
- [ ] **Stage 4: `proofvault-frontend/` Scaffolding & Implementation**

### Phase 4: Stylize (Pending Phase 3B)
- [ ] Dark navy / charcoal UI styling with refined glassmorphism
- [ ] Verification report PDF visual polish and styling
- [ ] Honest status indicator and spinner polish (no false positives)

### Phase 5: Trigger (Pending Phase 4)
- [ ] Local Hardhat to Sepolia deployment script execution
- [ ] Sepolia verification on Etherscan
- [ ] Automated reconciliation triggers and background listeners
- [ ] Production maintenance log finalized

---

## 6. Maintenance & Self-Annealing Log
- **2026-10-11 (Phase 1)**: Blueprint finalized and locked.
- **2026-10-11 (Phase 2 & 2A)**: Docker PostgreSQL 16 container launched and verified healthy with loopback binding `127.0.0.1:5432`. Sepolia verified.
- **2026-10-11 (Phase 3A)**: Formulated Layer 1 SOPs and review documents.
- **2026-10-12 (Phase 3B Stage 1)**: Scaffolding and implementation of `proofvault-blockchain/`. Implemented `ProofVault.sol` with OpenZeppelin `Ownable2Step`, authorized registrar access control, zero-value input guards, and 256-byte revocation reason limits. Executed 24 automated tests with 100% statement, branch, function, and line coverage. Verified local deployment on ephemeral Hardhat network (`scripts/deploy.ts`). Gas benchmarks: `registerDocument` $\approx 96,152$ gas, `revokeDocument` $\approx 53,281$ gas.
- **2026-10-13 (Phase 3B Stage 2)**: Scaffolding and implementation of `proofvault-backend/`. Implemented PostgreSQL Prisma schema with 6 models and applied migration `20261013141639_init_core_schema`. Implemented JWT authentication, bcrypt factor 12 password hashing, isolated private file storage, magic-byte file validation, exact-byte SHA-256 calculation, same-user deduplication, cross-user privacy boundaries, and contract interface integration. Executed 29 automated tests with 100% pass rate. Verified 0 database mutations during read queries and zero secrets leaked in responses/logs.
