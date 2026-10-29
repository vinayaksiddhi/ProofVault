# Layer 1 SOP: Security Controls & Privacy Boundaries
**SOP ID:** SOP-ARCH-003  
**Category:** Security, Cryptography & Privacy Protection  
**Status:** PROPOSED (Phase 3A Review)  
**Last Updated:** 2026-10-11  

---

## 1. Objective
Define strict operational boundaries to ensure complete data confidentiality, protect cryptographic signing keys, eliminate BOLA/IDOR vulnerabilities, and enforce zero leakage of sensitive metadata during public verification.

---

## 2. Security Boundaries Matrix

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SECURITY & TRUST TIERS                          │
├────────────────────┬────────────────────┬──────────────────────────────┤
│    PUBLIC TIER     │  AUTHENTICATED     │       RESTRICTED CORE        │
│  (Untrusted Users) │     (JWT Bearer)   │      (Backend Internal)      │
├────────────────────┼────────────────────┼──────────────────────────────┤
│ • Public verify UI │ • User dashboard   │ • Relayer private key        │
│ • Sanitized DTO    │ • Private docs     │ • DB credentials             │
│ • In-memory check  │ • Audit history    │ • Original storage files     │
│ • QR code redirect │ • Document upload  │ • Transaction nonce locks    │
└────────────────────┴────────────────────┴──────────────────────────────┘
```

---

## 3. Detailed Security Controls

### 3.1 Secret Management & Key Isolation
1. **Zero Key Exposure:** The relayer private key (`RELAYER_PRIVATE_KEY`) is stored strictly in backend environment variables. It is never transmitted across the network, included in API responses, or imported into frontend code.
2. **Untracked Environment:** All credentials reside in `.env`, which is strictly ignored by `.gitignore` and `.dockerignore`.
3. **No Production Funds:** The relayer wallet is dedicated exclusively to testnet development and must hold zero mainnet ETH.

### 3.2 Ingestion & Upload Validation
1. **Magic-Byte Sniffing:** Every upload is validated by inspecting the first 4,100 bytes via `file-type` to detect true binary headers. Files that do not match the permitted MIME whitelist (`application/pdf`, `image/png`, `image/jpeg`, DOCX) are rejected with `415 UNSUPPORTED_MEDIA_TYPE`.
2. **Streaming Size Guard:** Hard limit of 25 MB enforced at stream level. Files exceeding this threshold are aborted with `413 PAYLOAD_TOO_LARGE`.
3. **Storage Isolation:** Files are written to `./temp/storage/` (or S3) using random UUIDv4 names. Original filenames, extensions, and user metadata are stripped from the storage layer. Files are never placed in public web root folders.

### 3.3 Authorization & BOLA/IDOR Elimination
1. **Resource Scoping:** All document queries enforce ownership checks:
   ```sql
   SELECT * FROM "Document" WHERE id = :documentId AND "ownerId" = :currentUserId AND "isDeleted" = false;
   ```
2. **Uniform 404 Responses:** Unauthorized attempts to access documents owned by other users return `404 NOT_FOUND` rather than `403 FORBIDDEN`, preventing ID enumeration.
3. **Token Invalidation:** Revoking public visibility nullifies `publicVerificationToken`, instantly returning `404 NOT_FOUND` on public verification endpoints.

### 3.4 Public Verification Zero-Leakage Policy
Public verification endpoints (`/api/v1/public/verify/:token`) strictly enforce a sanitized DTO:
- **Disclosed:** Document Title (if `publishTitle: true`), Canonical SHA-256 Hash, Chain ID, Contract Address, Transaction Hash, Block Timestamp, and Match Result.
- **Strictly Omitted:** Owner Email, Owner User ID, Real Name, Original File Name, File Size, Storage Keys, File Bytes, and Off-Chain Audit History.
- **Candidate Files:** Files uploaded by public verifiers for byte-matching are rehashed in-memory and discarded immediately without persistent disk writes.
