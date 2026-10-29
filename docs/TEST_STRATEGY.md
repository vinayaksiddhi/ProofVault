# ProofVault — Test Strategy & Verification Plan
**Document ID:** PV-TEST-001  
**Status:** PHASE 1 BLUEPRINT REVIEW (Updated & Finalized)  
**Last Updated:** 2026-10-11  

---

## 1. Test Levels & Strategy Overview

```
┌────────────────────────────────────────────────────────┐
│                   END-TO-END SUITE                     │
│  • Full user flow: Register -> Upload -> Anchor ->     │
│    Verify -> Download PDF Report                       │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────┴────────────────────────────┐
│                  INTEGRATION SUITES                    │
│  • Backend API & Prisma DB Integration (Supertest)     │
│  • Hardhat Local Node & Ethers.js Provider Integration │
│  • Frontend Flow Tests (Vitest / Testing Library)      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────┴────────────────────────────┐
│            FAILURE & RECOVERY TEST SUITES              │
│  • DB Write Crash Recovery (Reconciliation Worker)     │
│  • RPC Outage & Timeout Simulation                     │
│  • Reverted Transactions & Gas Replacement             │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────┴────────────────────────────┐
│                      UNIT SUITES                       │
│  • Solidity Contracts (Hardhat / Mocha / Chai)         │
│  • Node.js Crypto Hashing & Magic Byte Detection       │
│  • Zod Validation Schemas & Error Envelope Builders    │
│  • React UI State Machines & Formatting Utilities      │
└────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Implementation Status Notice:** Implementation has NOT started. Zero tests have been executed or passed. The test cases cataloged below represent the formal test plan and acceptance gates for Phases 3 and 5.

---

## 2. Test Category Specifications & Test Cases

### 2.1 Smart Contract Unit & Security Tests (`proofvault-blockchain/test/`)
- **TC-SC-001 (Valid Registration):** Call `registerDocument` with valid `documentKey` and `documentHash`. Assert `DocumentRegistered` event emitted with matching parameters.
- **TC-SC-002 (Duplicate Key Rejection):** Call `registerDocument` twice with identical `documentKey`. Assert second call reverts with custom error `DocumentKeyAlreadyRegistered(documentKey)`.
- **TC-SC-003 (Read-Only Verification Match):** Call `verifyDocument` with matching candidate hash. Assert returns `(isMatch: true, registeredAt > 0, issuer == relayer, isRevoked: false)`.
- **TC-SC-004 (Read-Only Verification Mismatch):** Call `verifyDocument` with altered candidate hash. Assert returns `(isMatch: false, registeredAt > 0, issuer == relayer, isRevoked: false)`.
- **TC-SC-005 (Issuer Revocation):** Call `revokeDocument` from issuer address. Assert `DocumentRevoked` event emitted and `verifyDocument` returns `isRevoked: true`.
- **TC-SC-006 (Unauthorized Revocation):** Call `revokeDocument` from an unauthorized address. Assert call reverts with `NotAuthorized`.
- **TC-SC-007 (Gas Target Measurement):** Benchmark `registerDocument` execution against target of $\le 65,000$ gas.

### 2.2 Backend Authorization & Data Access Tests (`proofvault-backend/test/authz/`)
- **TC-AUTH-001 (Unauthenticated Request):** Call `/api/v1/documents` without token. Assert `401 Unauthorized`.
- **TC-AUTH-002 (Unauthorized Document Access - BOLA):** User A calls `GET /api/v1/documents/:id` for document owned by User B. Assert returns `404 Not Found` (zero data leakage).
- **TC-AUTH-003 (Unauthorized Visibility Modification):** User B attempts `PATCH /api/v1/documents/:id/visibility` on User A's document. Assert returns `404 Not Found`.

### 2.3 Document Ingestion & Deduplication Tests (`proofvault-backend/test/documents/`)
- **TC-DOC-001 (Valid Upload & Hashing):** Upload a valid 1 MB PDF. Assert canonical SHA-256 computed matches standard `sha256sum`, file stored with private UUID key, DB status `UPLOADED`.
- **TC-DOC-002 (Same-User Duplicate Upload - Q1):** User A uploads identical file twice. Assert second upload returns existing document reference with `200 OK` (or `409 Conflict`), avoids redundant storage, and does not submit second transaction.
- **TC-DOC-003 (Cross-User Duplicate Upload - Q2):** User B uploads identical file previously uploaded by User A. Assert User B receives distinct document record without any cross-user disclosure.
- **TC-DOC-004 (MIME Spoofing Rejection):** Upload an executable renamed to `.pdf`. Assert rejected with `415 UNSUPPORTED_MEDIA_TYPE` via magic byte inspection.
- **TC-DOC-005 (File Size Limit):** Upload a 30 MB file. Assert rejected with `413 PAYLOAD_TOO_LARGE`.

### 2.4 Blockchain Failure, Retry & Recovery Tests (`proofvault-backend/test/blockchain/`)
- **TC-REC-001 (Safe Idempotent Retries - Q4):** Trigger `register-on-chain` twice with same `idempotencyKey`. Assert backend pre-checks contract state and returns existing operation without double broadcasting.
- **TC-REC-002 (Reverted Transaction Handling - Q5):** Simulate contract revert (e.g. simulated gas exhaustion). Assert document marked `REGISTRATION_FAILED` with recorded error; file preserved; manual retry button enabled.
- **TC-REC-003 (Database Crash After Mining - Q6):** Simulate scenario where transaction is confirmed on-chain but database update was interrupted. Run Reconciliation Worker. Assert worker discovers mined transaction via RPC receipt and contract event, and updates database to `CONFIRMED_ON_CHAIN`.
- **TC-REC-004 (RPC Outage Handling):** Disconnect RPC node during submission. Assert transaction operation enters `PENDING` with retry backoff; does not crash server.
- **TC-REC-005 (Wrong Chain ID / Contract Address):** Start backend with mismatched `CHAIN_ID` or un-deployed contract address. Assert server fails fast during startup health check with clear error log.

### 2.5 Verification & Public Access Tests (`proofvault-backend/test/verify/`)
- **TC-VER-001 (Private Verification Match):** Submit matching candidate file against document ID. Assert returns `hashMatch: true`, `onChainStatus: MATCH_CONFIRMED_ON_CHAIN`.
- **TC-VER-002 (Private Verification 1-Byte Mismatch):** Submit file with single altered byte. Assert returns `hashMatch: false`, `onChainStatus: HASH_MISMATCH`.
- **TC-VER-003 (Public Verification Inspection - Q8):** Request `GET /api/v1/public/verify/:token`. Assert returns sanitized DTO with zero owner email, zero storage paths, zero private audit logs.
- **TC-VER-004 (Public Visibility Revocation - Q7):** Owner toggles document visibility back to `PRIVATE`. Call public endpoint with old token. Assert returns `404 Not Found`.

---

## 3. Measurable Acceptance Gates (Phase 3 & Phase 5 Sign-Off)

1. **Compilation & Static Analysis:**
   - 0 TypeScript compiler errors (`tsc --noEmit`).
   - 0 ESLint warnings.
   - 0 Solidity compilation errors/warnings.
2. **Deterministic Cryptographic Verification:**
   - SHA-256 calculation for test vectors yields exact standard hex digest across Node.js, CLI `sha256sum`, and Python.
3. **Honest Transaction Validation:**
   - Zero synthetic confirmations. Status changes to `CONFIRMED` strictly after RPC receipt confirms `status == 1`, matching contract address, matching event topics, and satisfying network confirmation threshold (`CONFIRMATION_THRESHOLD`).
4. **Target Test Coverage:**
   - Smart contracts: Comprehensive branch coverage for all execution paths and revert conditions.
   - Backend core services: $\ge 85\%$ line coverage across auth, ingestion, blockchain relayer, and verification services.

---

## 4. Phase 2 / 2A Connectivity Test Outcomes (Executed 2026-10-11)

| Test ID | Target Service | Tool / Command | Expected | Actual Outcome | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-LINK-01** | Local PostgreSQL (5432) | `tools/check_connectivity.py` | Port open | Port 5432 OPEN and listening | ✅ **PASS** |
| **TC-LINK-01A**| Container Healthcheck | `docker ps --filter name=proofvault-postgres` | Status `healthy` | `Up (healthy)`, port `127.0.0.1:5432->5432/tcp` | ✅ **PASS** |
| **TC-LINK-01B**| Persistent Volume Mount | `docker inspect proofvault-postgres` | Volume mounted | Named volume `proofvault_pgdata` mounted | ✅ **PASS** |
| **TC-LINK-01C**| Localhost-Only Port Binding| `Get-NetTCPConnection` | Bound to `127.0.0.1` | `127.0.0.1:5432 Listen` | ✅ **PASS** |
| **TC-LINK-01D**| Engine Version Check | `psql -c "SELECT version();"` | PostgreSQL 16.x | `PostgreSQL 16.15 on x86_64-pc-linux-musl` | ✅ **PASS** |
| **TC-LINK-01E**| Application Query Auth | `psql -U proofvault_user -c "SELECT 1;"` | Query returns `1` | `healthcheck_result: 1` (`1 row`) | ✅ **PASS** |
| **TC-LINK-02** | Local Hardhat RPC (8545) | `tools/check_connectivity.py` | Chain ID `31337` | Port 8545 closed (Node to launch in Phase 3) | ⚠️ **BLOCKED** |
| **TC-LINK-03** | Sepolia Public RPC | `tools/check_connectivity.py` | Chain ID `11155111` | Chain ID `11155111`, Block `11893294` | ✅ **PASS** |
| **TC-LINK-04** | Secrets Exposure Audit | File scan & `.gitignore` audit | Zero leaks | `.env` untracked, zero secrets exposed | ✅ **PASS** |


