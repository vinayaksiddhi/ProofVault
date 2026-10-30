# ProofVault — Testing Guide & Test Strategy

This document points to the automated testing strategies, suites, and verification baselines.

- **Testing Strategy & Suites:** See [TEST_STRATEGY.md](TEST_STRATEGY.md).
- **Latest Verification & Audit Report:** See [VERIFICATION_REPORT.md](VERIFICATION_REPORT.md).
- **Test Commands Summary:**
  - Smart Contracts (26 tests, 100% coverage): `cd proofvault-blockchain && npm test && npm run coverage`
  - Backend Unit Tests: `cd proofvault-backend && npm run test:unit`
  - Database Integration Tests (49 tests): `cd proofvault-backend && npm run test:db` (Requires PostgreSQL container on port 5432)
  - Live EVM Integration Tests (5 tests): `cd proofvault-backend && npm run test:integration` (Requires Hardhat node on port 8545 & PostgreSQL)
  - All Backend Tests (63 tests): `cd proofvault-backend && npm test`
