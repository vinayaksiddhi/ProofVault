# ProofVault — Requirements Specification
**Document ID:** PV-REQ-001  
**Status:** PHASE 1 BLUEPRINT REVIEW (Updated & Finalized)  
**Last Updated:** 2026-10-11  

---

## 1. System Vision & Purpose

ProofVault is a production-grade, decentralized document integrity and verification platform designed to bridge Web2 document management with Web3 cryptographic immutability. It allows individuals and organizations to establish an immutable, tamper-evident record of existence for digital files on public and private EVM blockchains without compromising data privacy.

The system proves that a specific sequence of bytes existed in an unmodified state at or before a verifiable blockchain block timestamp. It does not certify the real-world accuracy or legal truthfulness of the document's contents, and the user interface explicitly distinguishes between *document integrity* and *claim validity*.

---

## 2. Functional Requirements (FR)

### 2.1 Authentication & Authorization
- **FR-AUTH-001:** Users must register using a unique email address and a strong password (minimum 8 characters, at least 1 number, 1 uppercase, 1 symbol).
- **FR-AUTH-002:** Passwords must be hashed using `bcrypt` (work factor 12) prior to persistence. Plaintext passwords must never be stored or logged.
- **FR-AUTH-003:** Authentication must use stateless JWT tokens (Access Token: 15 minutes; Refresh Token: 7 days) with standard Bearer authorization.
- **FR-AUTH-004:** Role-Based Access Control (RBAC) must support `USER` and `ADMIN` roles.
- **FR-AUTH-005:** All private operations must validate bearer tokens; unauthorized requests must return `401 Unauthorized`. Access to resources owned by another user must return `404 Not Found` or `403 Forbidden` without leaking resource existence.

### 2.2 Document Management & Cryptographic Ingestion
- **FR-DOC-001:** Authenticated users can upload files via `multipart/form-data`.
- **FR-DOC-002:** Supported file formats must be strictly enforced via magic-byte / MIME inspection: PDF (`application/pdf`), PNG (`image/png`), JPEG (`image/jpeg`), and DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`).
- **FR-DOC-003:** File size must be capped at 25 MB per document.
- **FR-DOC-004:** Canonical SHA-256 hash must be computed server-side directly from the received byte stream. The browser may compute an informational client hash for pre-upload validation, but the server hash is the authoritative source.
- **FR-DOC-005:** Uploaded files must be stored in private storage (local filesystem in dev; encrypted S3/MinIO in production) using randomized UUID storage keys. Files must never be placed in public web root folders.
- **FR-DOC-006:** Users must provide optional metadata (`title`, `description`, `visibility`). Default visibility is `PRIVATE`.
- **FR-DOC-007 (Deduplication - Same User):** If the authenticated user uploads a file whose SHA-256 hash matches an existing document owned by that same user, the system detects duplicate content, aborts redundant storage and blockchain anchoring, and returns the existing document reference with `200 OK` (or `409 Conflict` with resource reference).
- **FR-DOC-008 (Cross-User Privacy):** If User B uploads a file with the identical hash as User A, the system creates a distinct document record for User B without disclosing any cross-user existence or information to either party.
- **FR-DOC-009 (Deletion Semantics):** When a user requests document deletion, the system purges off-chain file bytes, soft-deletes the database record, invalidates public verification tokens, and issues an explicit warning that on-chain cryptographic proofs cannot be erased.

### 2.3 Blockchain Registration & Relayer
- **FR-CHAIN-001:** Users can anchor a document's cryptographic fingerprint on-chain at upload time or trigger anchoring post-upload via an authorized action.
- **FR-CHAIN-002:** For the MVP, transactions are submitted by a backend-managed Relayer service funded exclusively with Sepolia testnet ETH. The Relayer's EVM address is recorded on-chain as the transaction `issuer`; it is explicitly distinct from the off-chain user's identity.
- **FR-CHAIN-003:** The smart contract accepts two 32-byte parameters:
  - `bytes32 documentKey`: Derived uniquely from the document identifier (`keccak256(bytes(documentId))`).
  - `bytes32 documentHash`: The canonical SHA-256 digest of the file bytes.
- **FR-CHAIN-004:** The transaction lifecycle must follow a deterministic state machine: `NOT_STARTED` ➔ `PENDING` ➔ `SUBMITTED` ➔ `CONFIRMED` (or `FAILED` / `RECONCILING`).
- **FR-CHAIN-005:** Transaction confirmation requires receipt validation (`status == 1`), contract address match, event verification, and meeting the network confirmation threshold (`CONFIRMATION_THRESHOLD_HARDHAT=1`, `CONFIRMATION_THRESHOLD_SEPOLIA=2`).
- **FR-CHAIN-006 (Idempotent Retries):** Retries must use persistent operation tracking and check on-chain contract state before broadcasting replacement transactions. Timeouts must not be treated as failures.

### 2.4 Integrity Verification (Private & Public)
- **FR-VER-001 (Private Verification):** Authenticated owners can submit a candidate file against an existing document ID. The server recomputes the SHA-256 digest in-memory and compares it against both the database record and the on-chain smart contract state.
- **FR-VER-002 (Public Verification):** When a document's visibility is set to `PUBLIC_VERIFIABLE`, third parties can access a public verification endpoint using an unguessable 256-bit verification token without authentication.
- **FR-VER-003 (Public Exposure Limitation):** The public verification endpoint strictly exposes only: Document Title (if configured), Canonical SHA-256 Hash, Chain ID, Contract Address, Transaction Hash, Block Timestamp, and Match Result. It never exposes user email, user ID, file bytes, storage keys, or private audit trails.
- **FR-VER-004:** Verification outcomes must distinguish:
  - `MATCH_CONFIRMED_ON_CHAIN`: Exact byte match, verified against confirmed blockchain proof.
  - `MATCH_PENDING_ON_CHAIN`: Exact byte match, blockchain transaction currently pending/submitted.
  - `HASH_MISMATCH`: Candidate file bytes differ from registered fingerprint.
  - `NOT_FOUND_ON_CHAIN`: Document key not registered in smart contract.
  - `CONTRACT_UNREACHABLE`: Blockchain RPC error; integrity check incomplete.
- **FR-VER-005:** Publicly verifiable documents generate a QR code linking to the verification portal.
- **FR-VER-006:** Users and public verifiers can download an official PDF verification report summarizing cryptographic and blockchain evidence.

### 2.5 Auditing & Activity History
- **FR-AUD-001:** All document lifecycle actions (`DOCUMENT_CREATED`, `BLOCKCHAIN_SUBMITTED`, `BLOCKCHAIN_CONFIRMED`, `BLOCKCHAIN_FAILED`, `VISIBILITY_CHANGED`, `VERIFICATION_ATTEMPTED`, `DOCUMENT_DELETED`) must generate immutable application audit entries.
- **FR-AUD-002:** Audit logs record `actorUserId` (or `anonymous` for public verifiers), salted IP hash, user agent, timestamp, event type, and outcome.
- **FR-AUD-003:** The UI displays an audit timeline distinguishing between off-chain database logs and cryptographically validated on-chain events.

---

## 3. Non-Functional Requirements (NFR)

### 3.1 Security & Cryptography
- **NFR-SEC-001:** Zero plaintext passwords or unencrypted private keys in code, database, logs, or repositories.
- **NFR-SEC-002:** Zero original document files, personal identities, or secrets stored on the public blockchain.
- **NFR-SEC-003:** Strict BOLA/IDOR protection; queries enforce ownership check `ownerId = currentUserId`.
- **NFR-SEC-004:** Streaming SHA-256 calculation to eliminate memory exhaustion on large uploads.
- **NFR-SEC-005:** Express rate limiting: Auth (5 req/min), Upload (10 req/min), Verification (30 req/min) per IP.

### 3.2 Performance & Scalability
- **NFR-PERF-001:** SHA-256 calculation for a 25 MB file must complete in under 500 ms on server hardware.
- **NFR-PERF-002:** Metadata retrieval API response time < 100 ms (p95).
- **NFR-PERF-003:** Blockchain polling utilizes exponential backoff to adhere to public RPC rate limits.

### 3.3 Reliability & Self-Healing
- **NFR-REL-001:** Self-healing reconciliation: If the backend restarts or a database write fails while a transaction is mined, a background worker scans RPC receipts and event logs to reconcile database state deterministically.
- **NFR-REL-002:** Idempotent submission: Duplicate clicks or retries must check contract state first and never submit duplicate on-chain registrations.

### 3.4 Usability & Honest UI
- **NFR-UI-001:** Responsive layout optimized for desktop and mobile devices.
- **NFR-UI-002:** Honest UI feedback: Visual spinners for upload, hashing, mempool broadcast, and confirmation. Never display a green "Verified" badge before on-chain receipt confirmation.

---

## 4. Scope Exclusions (Explicitly Out of Scope for MVP)

1. Ethereum Mainnet deployment (Local Hardhat and Sepolia testnet only).
2. Multi-chain bridging or cross-chain state synchronization.
3. Decentralized storage networks (IPFS/Filecoin) for document content (private off-chain storage is used to protect document confidentiality).
4. Decentralized Identity / W3C Verifiable Credentials (standard JWT authentication and EVM addresses used for MVP).
5. Client-side MetaMask signing implementation (planned as future extension; MVP uses backend relayer).
