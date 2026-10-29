# ProofVault — Architectural Decisions Log (Finalized Phase 1 & Phase 2 Review)
**Document ID:** PV-DEC-001  
**Status:** PHASE 2 LINK REVIEW  
**Last Updated:** 2026-10-11  

---

## 1. Approved Foundational Principles

1. **Three-Codebase Architecture:**
   - `proofvault-frontend/`: Client UI, verification portal, report exporter.
   - `proofvault-backend/`: API gateway, auth, streaming file hashing, private storage, relayer, reconciliation.
   - `proofvault-blockchain/`: Solidity contracts, Hardhat scripts, Sepolia deployment and verification.
   - Decoupled repositories with isolated dependencies, configurations, and test runners.

2. **Cryptographic Ground Truth:**
   - Canonical SHA-256 hash computed on the server directly from the raw original byte stream.
   - Client-side hashing is purely informational for pre-upload validation; the server calculation is authoritative.

3. **Strict Data Privacy on Blockchain:**
   - Zero file bytes, personal names, email addresses, or plaintext metadata stored on-chain.
   - Smart contracts only store a 32-byte registration key, a 32-byte cryptographic hash digest, a block timestamp, and the transaction issuer address.

4. **Network Deployment Scope:**
   - Hardhat local network (`chainId: 31337`) for deterministic development, integration testing, and CI.
   - Ethereum Sepolia testnet (`chainId: 11155111`) for live hackathon demonstration and public Etherscan verification.
   - Ethereum Mainnet is strictly out of scope for the MVP.

5. **A.N.T. Three-Layer Separation:**
   - Layer 1: Architecture SOPs in `architecture/` & `docs/`.
   - Layer 2: Navigation & Orchestration in `proofvault-backend/src/services/`.
   - Layer 3: Deterministic Tools in `proofvault-backend/src/tools/` and `tools/`.
   - Rule: Logic changes must update the Architecture SOP before implementation code is altered.

6. **Phase Execution Discipline:**
   - Phase 1 Blueprint locked.
   - Phase 2 Link verifies environment and connectivity only; zero application code, smart contracts, or migrations implemented.

---

## 2. Finalized Ten Decisions & Phase 2 Safety Reviews

### Decision Q1: Identical File Uploaded Again by the Same User
- **Policy:** Deduplicate and reference existing document.
- **Specification:**
  - When a user uploads a file, the server computes its canonical SHA-256 hash.
  - The backend checks for existing documents owned by the *current authenticated user* (`WHERE ownerId = :currentUserId AND sha256Hash = :hash AND isDeleted = false`).
  - If a match is found:
    1. The newly received upload stream is discarded from temporary buffers without allocating permanent storage.
    2. The API returns HTTP `200 OK` (or `409 Conflict` with resource reference) containing the existing document DTO.
    3. No redundant blockchain transaction is created or submitted.
    4. An audit event `DUPLICATE_UPLOAD_BLOCKED` is recorded for that user.
  - If the matching document was previously owned by *another user*, this information is **strictly not disclosed** (see Q2).

### Decision Q2: Identical File Uploaded by a Different User
- **Policy:** Allow distinct document record; do not disclose cross-user duplicates; document privacy implications.
- **Specification:**
  - If User B uploads a file with the identical hash as User A:
    1. A separate `Document` record is created for User B with a new `documentId` and new unguessable `storageKey`.
    2. The API gives zero indication that User A previously uploaded this file, preventing timing and hash-enumeration attacks.
    3. **Blockchain Anchoring Policy:** Because the smart contract keys registrations by `documentKey` (derived from `keccak256(bytes(documentId))`), User B's registration is anchored under User B's distinct `documentKey` on-chain, creating an independent verifiable proof of User B's document registration.
    4. The backend audit log records an internal cross-reference flag (`crossUserDuplicate: true`) accessible only to system administrators for audit/compliance purposes.
    5. **Privacy Tradeoff:** While this consumes separate transaction gas on Sepolia, it preserves zero-knowledge isolation between distinct users.

### Decision Q3: Blockchain Transaction Signing Model
- **Policy:** Backend-managed relayer for MVP; client-side MetaMask signing deferred to post-MVP.
- **Specification:**
  - For the initial MVP, all on-chain registrations are signed and broadcast by a dedicated backend relayer wallet.
  - The relayer wallet is funded exclusively on Ethereum Sepolia testnet using free faucet funds.
  - **Security Rules:**
    - Never use real mainnet ETH or production wallets for the MVP.
    - Relayer private key resides strictly in `proofvault-backend/.env` (and environment variables).
    - Never expose the private key to the frontend or version control.
    - Contract signing logic is isolated behind an abstract `IBlockchainRelayer` interface.
  - **MetaMask Future Extension:** The smart contract interface `registerDocument(bytes32, bytes32)` is public and permissionless, allowing a future frontend update to support direct EIP-1193 MetaMask user signing without modifying contract code.

### Decision Q4: Transaction Retry, Idempotency & Safety Policy (Phase 2 Review)
- **Policy:** Bounded retries, persistent operation tracking, and non-destructive error handling.
- **Phase 2 Safety Review Findings:**
  1. **Timeout Does Not Mean Failure:** In public networks like Sepolia, network congestion or fluctuating gas fees can keep a transaction in the mempool for over 10 minutes without it being dropped. A timeout must *never* be treated as transaction failure or an excuse to double-spend nonces.
  2. **Receipt and Contract State Pre-Flight:** Before any retry or gas-replacement action:
     - The relayer queries `provider.getTransactionReceipt(previousTxHash)`.
     - The relayer queries contract read `getDocument(documentKey)`. If already confirmed, the operation is immediately marked `CONFIRMED_ON_CHAIN` without broadcasting any new transaction.
  3. **Gas Replacement Policy Evaluation:**
     - The standard EIP-1559 mempool replacement rule mandates a minimum 10% increase in `maxFeePerGas` and `maxPriorityFeePerGas` to replace a pending transaction sharing the same nonce.
     - The proposed **15% bump** satisfies protocol minimums. However, this is marked as a **provisional heuristic requiring integration testing in Phase 3**; dynamic gas estimation using current base fee + 15% priority fee will be benchmarked to prevent out-of-funds errors on high volatility.
  4. **Retry Bounds:** Maximum automated retries capped at **3**. Exponential backoff: 30s, 90s, 270s. If unresolved, transaction transitions to `STALLED_NEEDS_RECONCILIATION` requiring operator review.

### Decision Q5: File Storage Succeeds but Blockchain Registration Fails
- **Policy:** Preserve off-chain record; mark status honestly; provide authorized manual retry.
- **Specification:**
  - If a file is successfully uploaded and stored on disk/S3, but the blockchain transaction reverts, runs out of gas, or suffers an unrecoverable RPC error:
    1. The stored file and database record are preserved.
    2. Document `registrationStatus` is set to `REGISTRATION_FAILED` (or `SUBMITTED_TO_CHAIN` if broadcast is unconfirmed).
    3. The failure reason (e.g., revert message, RPC timeout) is recorded in `TransactionOperation.lastError` and `AuditLog`.
    4. An authenticated endpoint `POST /api/v1/documents/:id/register-on-chain` is exposed allowing the document owner to re-trigger anchoring.
    5. The UI must never display a green "Verified" or "Confirmed" badge for a failed or unconfirmed registration.

### Decision Q6: Blockchain Registration Succeeds but Database Update Fails
- **Policy:** Self-healing reconciliation worker with idempotent state recovery.
- **Specification:**
  - Scenario: The relayer transaction is mined on Sepolia, but the backend process crashes or database connection drops before updating PostgreSQL.
  - **Recovery Mechanism:**
    1. The backend runs a periodic **Reconciliation Worker** (every 60 seconds).
    2. The worker scans for records in `SUBMITTED_TO_CHAIN` or `STALLED_NEEDS_RECONCILIATION` status older than 2 minutes.
    3. The worker queries the RPC provider for the transaction receipt and inspects on-chain events (`DocumentRegistered`).
    4. If the event is verified with the expected `documentKey` and `documentHash`, the worker idempotently updates `BlockchainRegistration` to `CONFIRMED` and `Document` to `CONFIRMED_ON_CHAIN`.
    5. A unit and integration test suite verifies this exact crash-recovery flow.

### Decision Q7: Document Visibility and Public Verification Access
- **Policy:** Private by default; opt-in public verification; explicit access revocation semantics.
- **Specification:**
  - Visibility states: `PRIVATE` (default) and `PUBLIC_VERIFIABLE`.
  - Only the authenticated owner can toggle visibility via `PATCH /api/v1/documents/:id/visibility`.
  - When set to `PUBLIC_VERIFIABLE`:
    1. A cryptographically secure, unpredictable 256-bit token (`publicVerificationToken`, 64 hex characters) is generated.
    2. A public verification URL (`/verify/:token`) and corresponding QR code are generated.
  - When revoked back to `PRIVATE`:
    1. The `publicVerificationToken` is nullified in PostgreSQL.
    2. Any subsequent public requests to the old URL return HTTP `404 NOT_FOUND`.
    3. **Blockchain Note:** The UI and documentation explicitly warn the user that revoking off-chain visibility does *not* erase the historical transaction hash or timestamp from the public blockchain ledger.

### Decision Q8: Public Verification Data Exposure Policy
- **Policy:** Strict zero-leakage public verification DTO; configurable title display.
- **Specification:**
  - When a public third party verifies a document via `/api/v1/public/verify/:token`:
    - **Exposed Fields (Strictly Limited):** Document Title (if `publishTitle` is enabled; otherwise masked), Canonical SHA-256 Hash, On-Chain Status, Chain ID (`11155111`), Network Name (`Ethereum Sepolia`), Contract Address, Transaction Hash, Block Number, Registration Block Timestamp, Block Explorer Link.
    - **Strictly Hidden Fields (Zero Exposure):** Owner Email, Owner User ID, Real Name, Original File Name, File Size, File Mime Type, Storage Key, Storage URL, Private File Bytes, Off-chain Audit Logs.

### Decision Q9: Document Deletion and Revocation Policy
- **Policy:** Off-chain deletion purges private data; on-chain proof is immutable; clear user disclosure.
- **Specification:**
  - Deleting a document (`DELETE /api/v1/documents/:id`):
    1. Requires explicit confirmation in the UI with a bold warning that on-chain proofs cannot be erased.
    2. Purges the private document file bytes from disk/storage immediately.
    3. Soft-deletes the `Document` row (`isDeleted = true`, `deletedAt = now()`) and anonymizes title/description.
    4. Invalidates the `publicVerificationToken`.
    5. Retains a minimal tombstone in `AuditLog` (`DOCUMENT_DELETED`).
  - **On-Chain Revocation:** If the owner requests on-chain revocation, the relayer submits `revokeDocument(documentKey, reason)`. The contract marks `isRevoked = true`, permanently recording revocation on-chain.

### Decision Q10: Transaction Confirmation and Finality Thresholds
- **Policy:** Network-configurable confirmation thresholds; explicit receipt and event verification.
- **Specification:**
  - Thresholds are configurable via environment variables:
    - **Local Hardhat (`chainId: 31337`):** `CONFIRMATION_THRESHOLD_HARDHAT=1` (Instant finality on local test node).
    - **Ethereum Sepolia (`chainId: 11155111`):** `CONFIRMATION_THRESHOLD_SEPOLIA=2` (~24 seconds, 2 blocks) for demo and hackathon purposes.
  - To transition a transaction to `CONFIRMED`:
    1. Receipt status must be `1` (Success).
    2. Confirmation count must satisfy `currentBlock - receipt.blockNumber + 1 >= CONFIRMATION_THRESHOLD`.
    3. Destination address `receipt.to` must match configured `CONTRACT_ADDRESS`.
    4. Receipt logs must contain the `DocumentRegistered` event with the expected `documentKey` and `documentHash`.
    5. Contract read `getDocument(documentKey)` must return matching `documentHash`.
