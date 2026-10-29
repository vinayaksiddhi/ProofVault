# ProofVault — API Contracts & JSON Schemas
**Document ID:** PV-API-001  
**Status:** PHASE 1 BLUEPRINT REVIEW (Updated & Finalized)  
**Last Updated:** 2026-10-11  

---

## 1. Response Envelope Specification

Every API endpoint under `/api/v1/` adheres to a strict, predictable envelope structure.

### 1.1 Success Response Envelope
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ApiSuccessEnvelope",
  "type": "object",
  "required": ["success", "data", "error"],
  "properties": {
    "success": {
      "type": "boolean",
      "const": true
    },
    "data": {
      "type": ["object", "array", "null"]
    },
    "error": {
      "type": "null"
    }
  },
  "additionalProperties": false
}
```

### 1.2 Error Response Envelope
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ApiErrorEnvelope",
  "type": "object",
  "required": ["success", "data", "error"],
  "properties": {
    "success": {
      "type": "boolean",
      "const": false
    },
    "data": {
      "type": "null"
    },
    "error": {
      "type": "object",
      "required": ["code", "message", "details", "requestId"],
      "properties": {
        "code": {
          "type": "string",
          "enum": [
            "BAD_REQUEST",
            "UNAUTHORIZED",
            "FORBIDDEN",
            "NOT_FOUND",
            "CONFLICT",
            "UNSUPPORTED_MEDIA_TYPE",
            "PAYLOAD_TOO_LARGE",
            "BLOCKCHAIN_RPC_ERROR",
            "TRANSACTION_REVERTED",
            "RATE_LIMITED",
            "INTERNAL_SERVER_ERROR"
          ]
        },
        "message": { "type": "string" },
        "details": { "type": "object" },
        "requestId": { "type": "string" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

---

## 2. API Endpoint Policy & Inventory

| Method | Endpoint | Auth | Authz Policy | Validation Rules | Error Conditions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | None | Public | Email valid, password >=8 chars, uppercase, number, symbol | `400 BAD_REQUEST`, `409 CONFLICT` |
| `POST` | `/api/v1/auth/login` | None | Public | Email and password required | `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `429 RATE_LIMITED` |
| `POST` | `/api/v1/auth/logout` | JWT | Current User | Bearer token valid | `401 UNAUTHORIZED` |
| `GET` | `/api/v1/auth/me` | JWT | Current User | None | `401 UNAUTHORIZED` |
| `POST` | `/api/v1/documents` | JWT | Current User | `multipart/form-data`: file <= 25MB, MIME in [pdf,png,jpg,docx], title 1-255 chars | `400 BAD_REQUEST`, `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE` |
| `GET` | `/api/v1/documents` | JWT | Current User | Filter by `ownerId = currentUserId`, paginated (`limit`, `offset`) | `401 UNAUTHORIZED` |
| `GET` | `/api/v1/documents/:id` | JWT | Owner / Shared | Verify ownership or permission record; omit storage keys | `401 UNAUTHORIZED`, `404 NOT_FOUND` |
| `PATCH`| `/api/v1/documents/:id/visibility`| JWT | Owner Only | Body: `{ visibility: "PRIVATE" \| "PUBLIC_VERIFIABLE", publishTitle?: boolean }` | `400 BAD_REQUEST`, `403 FORBIDDEN`, `404 NOT_FOUND` |
| `DELETE`| `/api/v1/documents/:id` | JWT | Owner Only | Purges private file bytes, soft-deletes DB row, retains audit log | `403 FORBIDDEN`, `404 NOT_FOUND` |
| `POST` | `/api/v1/documents/:id/register-on-chain` | JWT | Owner Only | Check doc not already confirmed; check relayer queue | `400 BAD_REQUEST`, `409 CONFLICT`, `503 BLOCKCHAIN_RPC_ERROR` |
| `GET` | `/api/v1/documents/:id/chain-status` | JWT | Owner / Shared | Query persistent `TransactionOperation` and RPC status | `404 NOT_FOUND` |
| `POST` | `/api/v1/documents/:id/verify` | JWT | Owner / Shared | Candidate file multipart; compare SHA-256 against DB & chain | `400 BAD_REQUEST`, `404 NOT_FOUND` |
| `GET` | `/api/v1/documents/:id/history` | JWT | Owner Only | Return application audit entries and on-chain events | `403 FORBIDDEN`, `404 NOT_FOUND` |
| `GET` | `/api/v1/documents/:id/report` | JWT | Owner / Shared | Query metadata, receipts, audit summary -> stream PDF buffer | `404 NOT_FOUND` |
| `GET` | `/api/v1/public/verify/:token` | None | Public | Token format 64 hex chars; document `visibility == PUBLIC_VERIFIABLE` | `404 NOT_FOUND` (no data leakage) |
| `POST` | `/api/v1/public/verify/:token/check`| None | Public | Candidate file <= 25MB; recompute hash; discard file; return match | `400 BAD_REQUEST`, `404 NOT_FOUND` |
| `GET` | `/api/v1/public/verify/:token/report`| None | Public | Valid public token; returns sanitized public evidence PDF | `404 NOT_FOUND` |

---

## 3. Machine-Readable JSON Schemas

### 3.1 Document Ingestion Request Metadata
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DocumentUploadMetadata",
  "type": "object",
  "required": ["title"],
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 255 },
    "description": { "type": "string", "maxLength": 2000 },
    "visibility": { "type": "string", "enum": ["PRIVATE", "PUBLIC_VERIFIABLE"], "default": "PRIVATE" },
    "publishTitle": { "type": "boolean", "default": true },
    "publishDescription": { "type": "boolean", "default": false },
    "registerOnChain": { "type": "boolean", "default": true }
  },
  "additionalProperties": false
}
```

### 3.2 Document Registration Response Payload
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DocumentRegistrationPayload",
  "type": "object",
  "required": [
    "documentId", "title", "originalFileName", "fileSize",
    "mimeType", "sha256Hash", "registrationStatus", "createdAt"
  ],
  "properties": {
    "documentId": { "type": "string", "format": "uuid" },
    "title": { "type": "string" },
    "description": { "type": ["string", "null"] },
    "visibility": { "type": "string", "enum": ["PRIVATE", "PUBLIC_VERIFIABLE"] },
    "originalFileName": { "type": "string" },
    "fileSize": { "type": "integer", "minimum": 1 },
    "mimeType": { "type": "string" },
    "sha256Hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "publicVerificationToken": { "type": ["string", "null"] },
    "registrationStatus": {
      "type": "string",
      "enum": [
        "UPLOADED",
        "SUBMITTED_TO_CHAIN",
        "CONFIRMED_ON_CHAIN",
        "REGISTRATION_FAILED",
        "STALLED_NEEDS_RECONCILIATION"
      ]
    },
    "blockchain": {
      "type": ["object", "null"],
      "properties": {
        "chainId": { "type": "integer" },
        "contractAddress": { "type": "string", "pattern": "^0x[a-fA-F0-9]{40}$" },
        "documentKey": { "type": "string", "pattern": "^0x[a-fA-F0-9]{64}$" },
        "transactionHash": { "type": "string", "pattern": "^0x[a-fA-F0-9]{64}$" },
        "blockNumber": { "type": ["integer", "null"] },
        "status": { "type": "string", "enum": ["PENDING", "SUBMITTED", "CONFIRMED", "FAILED"] },
        "confirmations": { "type": "integer", "minimum": 0 },
        "registeredAt": { "type": ["string", "null"], "format": "date-time" }
      }
    },
    "createdAt": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

### 3.3 Verification Result Payload (Public & Private)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "VerificationResultPayload",
  "type": "object",
  "required": [
    "verificationId", "documentId", "submittedHash",
    "canonicalHash", "hashMatch", "onChainStatus", "verifiedAt"
  ],
  "properties": {
    "verificationId": { "type": "string", "format": "uuid" },
    "documentId": { "type": "string", "format": "uuid" },
    "submittedHash": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "canonicalHash": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "hashMatch": { "type": "boolean" },
    "onChainStatus": {
      "type": "string",
      "enum": [
        "MATCH_CONFIRMED_ON_CHAIN",
        "MATCH_PENDING_ON_CHAIN",
        "HASH_MISMATCH",
        "NOT_FOUND_ON_CHAIN",
        "CONTRACT_UNREACHABLE",
        "STALLED_NEEDS_RECONCILIATION"
      ]
    },
    "blockchainEvidence": {
      "type": ["object", "null"],
      "properties": {
        "chainId": { "type": "integer" },
        "networkName": { "type": "string" },
        "contractAddress": { "type": "string" },
        "transactionHash": { "type": "string" },
        "blockNumber": { "type": "integer" },
        "blockTimestamp": { "type": "string", "format": "date-time" },
        "issuer": { "type": "string" },
        "explorerUrl": { "type": "string", "format": "uri" }
      }
    },
    "verifiedAt": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

### 3.4 Public Verification Inspection DTO (Zero Data Leakage)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PublicVerificationInspectionPayload",
  "type": "object",
  "required": [
    "title",
    "sha256Hash",
    "registrationStatus",
    "chainId",
    "contractAddress",
    "transactionHash",
    "blockTimestamp"
  ],
  "properties": {
    "title": { "type": "string" },
    "description": { "type": ["string", "null"] },
    "sha256Hash": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "registrationStatus": { "type": "string" },
    "chainId": { "type": "integer" },
    "networkName": { "type": "string" },
    "contractAddress": { "type": "string" },
    "transactionHash": { "type": "string" },
    "blockNumber": { "type": "integer" },
    "blockTimestamp": { "type": "string", "format": "date-time" },
    "explorerUrl": { "type": "string", "format": "uri" }
  },
  "additionalProperties": false
}
```
