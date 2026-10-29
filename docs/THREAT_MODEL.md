# ProofVault — Threat Model & Security Architecture
**Document ID:** PV-SEC-001  
**Status:** PHASE 1 BLUEPRINT REVIEW (Updated & Finalized)  
**Last Updated:** 2026-10-11  

---

## 1. Threat Analysis & Mitigation Matrix

| Threat ID | Threat Vector | Impact | Technical Mitigation |
| :--- | :--- | :--- | :--- |
| **THREAT-01** | **BOLA / IDOR:** Attacker requests `/api/v1/documents/:id` of another user | Unauthorized document metadata leakage | Authorization middleware filters `WHERE id = :id AND ownerId = :currentUserId`. Public access strictly routed via unguessable `publicVerificationToken`. Returns `404 Not Found` without disclosing existence. |
| **THREAT-02** | **Broken Role Authorization:** User attempts admin endpoints | Privilege escalation | Strict JWT claim verification and role-check guard `requireRole('ADMIN')`. |
| **THREAT-03** | **Malicious File Upload:** Executable or polyglot disguised as PDF/PNG | Server compromise, RCE | Multi-tier file sanitization: Inspect magic numbers via `file-type`, strip dangerous metadata, store files outside web root with randomized UUID keys, never execute stored files. |
| **THREAT-04** | **File Size Exhaustion (DoS):** Uploading multi-gigabyte files | Disk exhaustion, server OOM | Multer hard limit capped at 25 MB; streaming SHA-256 calculation rejects requests immediately if stream exceeds threshold. |
| **THREAT-05** | **MIME-Type Spoofing:** Altered `Content-Type` header | Bypass file restrictions | Binary buffer header inspection verifies true magic bytes against permitted MIME whitelist (`application/pdf`, `image/png`, `image/jpeg`, DOCX zip signature). |
| **THREAT-06** | **Duplicate Registrations (Same User):** Same document uploaded repeatedly | Wasted storage, double gas spend | Indexed lookup `(ownerId, sha256Hash)` returns existing document reference without re-allocating storage or broadcasting on-chain transactions (Decision Q1). |
| **THREAT-07** | **Cross-User Hash Enumeration:** Attacker checks if another user owns a document | Privacy violation | If User B uploads same file as User A, User B gets a distinct document without any cross-user disclosure or timing differences (Decision Q2). |
| **THREAT-08** | **Replay & Duplicate Transactions:** Double-clicking registration | Multiple identical transactions | Client submits unique `idempotencyKey`; backend tracks `TransactionOperation` with unique constraint and pre-checks on-chain state before sending (Decision Q4). |
| **THREAT-09** | **Key Compromise:** Leakage of relayer private key | Unauthorized contract transactions | Dedicated relayer wallet funded exclusively with testnet ETH; private key stored in backend `.env`; never committed to Git; never exposed to frontend (Decision Q3). |
| **THREAT-10** | **Fake Confirmations:** Client injects arbitrary `txHash` | System falsifies proof status | Backend queries RPC node directly: validates receipt `to` equals `CONTRACT_ADDRESS`, receipt `status == 1`, confirms emitted event topic matches `documentKey`. |
| **THREAT-11** | **Wrong Network / Contract Configuration:** Deploying on wrong chain ID | Failed calls, lost data | Backend startup asserts `network.chainId === EXPECTED_CHAIN_ID` and verifies contract code size > 0 at configured `CONTRACT_ADDRESS`. |
| **THREAT-12** | **State Desynchronization / Crashed DB Writes:** DB write fails after tx mined | Inconsistent user state | Background self-healing reconciliation worker scans pending records, re-queries RPC receipts and events, and reconciles DB deterministically (Decision Q6). |
| **THREAT-13** | **Public Metadata Leakage:** Verifier sees owner email or private path | Privacy breach | Public endpoints return sanitized DTO: strictly omit `ownerId`, `originalFileName`, `storageKey`, internal paths, and off-chain audit logs (Decision Q8). |
| **THREAT-14** | **Phishing Verification URLs:** Fake verification domains | Trust degradation | Public verification returns verifiable on-chain contract address, chain ID, and direct Etherscan link so users can independently verify off-platform. |
| **THREAT-15** | **Rate Limit Abuse:** Spamming upload or verification endpoints | Resource exhaustion | Express rate limiter: Auth (5 req/min), Upload (10 req/min), Public Verification (30 req/min) per IP. |
| **THREAT-16** | **Audit Log Tampering:** Malicious actor modifies DB logs | Erased history | Database user permissions restrict `AuditLog` to `INSERT` and `SELECT` only (no `UPDATE` or `DELETE` granted). |
| **THREAT-17** | **Interrupted Uploads & Orphaned Files:** Upload drops midway | Orphaned storage files | Ephemeral upload temp files cleaned up immediately on error via `try/finally` blocks; periodic cleaner sweeps unreferenced storage keys. |

---

## 2. Cryptographic Integrity Guarantees

1. **Deterministic Hashing:** SHA-256 computed using Node.js native `crypto.createHash('sha256')` over exact file bytes.
2. **Byte Representation in Solidity:** Digest converted to `bytes32` (`0x` + 64 hex characters) matching `bytes32` storage conventions.
3. **Document Key Derivation:**
   $$\text{documentKey} = \text{keccak256}(\text{bytes}(\text{documentId}))$$
   Guarantees unique registry keys per document record.
