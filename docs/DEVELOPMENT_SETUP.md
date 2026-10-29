# ProofVault — Verified Development & Testing Setup
**Document ID:** PV-DEV-001  
**Status:** VERIFIED LOCAL BASELINE  
**Last Updated:** 2026-10-30  

---

## 1. Prerequisites & Environment Baseline

| Component | Target Version | Verified Local Environment | Notes |
| :--- | :--- | :--- | :--- |
| **Node.js** | `>=20.0.0` (LTS) | `v25.2.1` | Hardhat outputs informational warning on Node >22; operations pass |
| **npm** | `>=10.0.0` | `11.6.2` | Package manager |
| **Docker** | `>=24.0.0` | `29.7.2` | Docker Desktop with WSL2 engine |
| **PostgreSQL** | `16-alpine` | `16.15` via Docker | Port `127.0.0.1:5432`, persistent volume `proofvault_pgdata` |
| **Hardhat** | `^2.22.18` | `2.22.18` | Local JSON-RPC port `127.0.0.1:8545` (Chain ID `31337`) |

---

## 2. Infrastructure Initialization

### 2.1 Database (PostgreSQL 16)
Docker Compose manages the dedicated PostgreSQL container:
```bash
# Start PostgreSQL service in background
docker compose up -d

# Check health status
docker compose ps
```
Connection parameters (`.env`):
- Host: `127.0.0.1`
- Port: `5432`
- Database: `proofvault_db`
- User: `proofvault_user`
- URL: `postgresql://proofvault_user:proofvault_password@127.0.0.1:5432/proofvault_db?schema=public`

### 2.2 Database Migrations (Prisma)
From `proofvault-backend/`:
```bash
# Verify migration status
npm run prisma:status

# Generate Prisma Client
npm run prisma:generate

# Apply pending migrations (production/CI safe)
npm run prisma:deploy
```
Active migrations:
- `20261013141639_init_core_schema`: Initial 6 models (`User`, `Document`, `BlockchainRegistration`, `DocumentPermission`, `AuditLog`, `TransactionOperation`).

---

## 3. Testing Workflows

### 3.1 Smart Contract Layer (`proofvault-blockchain/`)
```bash
cd proofvault-blockchain

# Compile Solidity contracts
npm run compile

# Run Hardhat test suite (24 unit/security/gas tests)
npm test

# Run code coverage
npm run coverage
```

### 3.2 Backend Layer (`proofvault-backend/`)
Backend test suites are categorized by dependencies:

1. **Isolated / Unit Tests** (No external services required):
   - `test/receipt-validation.test.ts` (9 tests)
2. **Database-Dependent Tests** (Requires active PostgreSQL on 5432):
   - `test/db-connectivity.test.ts` (4 tests)
   - `test/auth.test.ts` (7 tests)
   - `test/document-ingestion.test.ts` (7 tests)
   - `test/document-lifecycle.test.ts` (5 tests)
   - `test/coordination.test.ts` (5 tests)
   - `test/blockchain-integration.test.ts` (6 tests)
   - `test/reconciliation-worker.test.ts` (13 tests)
3. **Live EVM Integration Tests** (Requires active PostgreSQL + Hardhat node on 8545):
   - `test/live-evm-integration.test.ts` (5 tests)

To execute a targeted suite:
```bash
cd proofvault-backend
npx mocha -r ts-node/register "test/db-connectivity.test.ts" --timeout 15000 --exit
```

---

## 4. Local Hardhat Blockchain Node

To run a persistent local Hardhat node for manual testing or live EVM verification:
```bash
cd proofvault-blockchain
npm run node
# Listens at http://127.0.0.1:8545 with prefunded test accounts (Chain ID 31337)
```

To deploy the `ProofVault` contract locally:
```bash
npm run deploy:local
```
Update `proofvault-backend/.env` with the deployed contract address.
