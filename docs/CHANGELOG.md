# ProofVault Changelog

All notable changes to the ProofVault platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Root `README.md` containing complete project specification, architecture sequence & flow charts, verified test counts, and API matrices.
- Documentation hub linking API reference, smart contracts, database schemas, and threat model.

---

## [1.0.0-phase3] - 2026-10-30

### Added
- **Smart Contract Layer (`proofvault-blockchain`):**
  - `ProofVault.sol` with `Ownable2Step`, authorized registrars, document registration, revocation, and gas-free read-only verification.
  - Complete Hardhat test suite (26/26 tests, 100% statement, branch, function, and line coverage).
  - Gas usage profiling: <96.2k gas for registration, <53.3k gas for revocation.
- **Backend Service Layer (`proofvault-backend`):**
  - Node.js 20+ Express API with TypeScript and Prisma ORM.
  - User authentication service with bcrypt password hashing and JWT access/refresh tokens.
  - Document ingestion pipeline with streaming canonical SHA-256 computation and private local storage.
  - Ethers.js v6 blockchain relayer with in-memory nonce locking and receipt validation.
  - Self-healing `ReconciliationWorker` resolving stuck or dropped blockchain operations.
  - Dual verification APIs: authenticated private verification and sanitized token-based public verification.
- **Infrastructure:**
  - PostgreSQL 16 containerization via Docker Compose.
  - Initial Prisma migration `20261013141639_init_core_schema`.
  - Automated test suites (63 tests: 9 unit, 49 DB integration, 5 live local Hardhat EVM integration).

### Fixed
- **TD-011:** Fixed boolean existence check in `blockchainService.preFlightCheck` (properly evaluates non-zero hash and registration timestamp).
- **TD-007:** Corrected upload endpoint URL in `test/live-evm-integration.test.ts` to `/api/v1/documents`.
- **Node Nonce Caching:** Resolved Ethers v6 nonce cache synchronization with local automining Hardhat nodes.
