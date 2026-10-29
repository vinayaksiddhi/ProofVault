# ProofVault — Phase 2 Connectivity & Environment Report
**Document ID:** PV-LINK-001  
**Protocol Phase:** Phase 2 / 2A — Link (Environment & PostgreSQL Handshake)  
**Execution Date:** 2026-10-11  
**Status:** VERIFIED & DOCUMENTED  

---

## 1. Environment Inventory

| Component | Detected Version / State | Status | Verification Detail |
| :--- | :--- | :--- | :--- |
| **Operating System** | Windows 11 (NT kernel) | Available | Host environment |
| **Node.js** | `v25.2.1` | Available | Compatible with modern ES modules & tooling |
| **npm** | `11.6.2` | Available | Node Package Manager |
| **Git** | `2.52.0.windows.1` | Available | Installed on host (Workspace is not a Git repo) |
| **Python** | `3.13.7` | Available | Used for deterministic Phase 2 diagnostic tools |
| **Docker Engine** | Docker `29.7.2` (Desktop) | Active / Running | Verified via `docker ps` |
| **PostgreSQL Engine** | PostgreSQL `16.15` | **Healthy** | Docker container `proofvault-postgres` (`postgres:16-alpine`) |
| **Database Port** | `127.0.0.1:5432` | **Listening** | Verified strictly bound to localhost (`127.0.0.1`) |
| **Persistent Volume** | `proofvault_pgdata` | **Mounted** | Attached to `/var/lib/postgresql/data` |
| **Dedicated Database** | `proofvault_db` | **Initialized** | Ready for application migrations in Phase 3 |
| **Dedicated User** | `proofvault_user` | **Verified** | Executed `SELECT 1;` successfully |
| **Hardhat Tooling** | Global CLI not present | Unconfigured | Dev dependency in `proofvault-blockchain` (Phase 3) |
| **Security Files** | `.gitignore`, `.dockerignore` | **Active** | Excludes secret environment files; retains `.env.example` |
| **`.env.example`** | Present in workspace root | Validated | Contains complete safe variable placeholders |
| **`.env` File** | Present in workspace root | **Protected** | Untracked development credentials; zero secrets printed |

---

## 2. Configuration Readiness Audit

Comparison between `.env.example`, `.env`, and approved architecture specifications:

| Variable Name | Category | Status in Configuration | Purpose & Security Scope |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Application | Configured | Runtime mode (`development`) |
| `PORT` | Application | Configured | Backend HTTP listening port (`4000`) |
| `POSTGRES_USER` | Persistence | Configured | Dedicated database user (`proofvault_user`) |
| `POSTGRES_PASSWORD` | Persistence | Configured | Local development password (Protected in untracked `.env`) |
| `POSTGRES_DB` | Persistence | Configured | Dedicated development database (`proofvault_db`) |
| `POSTGRES_PORT` | Persistence | Configured | Database port (`5432`) |
| `DATABASE_URL` | Persistence | Configured | `postgresql://proofvault_user:***@127.0.0.1:5432/proofvault_db?schema=public` |
| `JWT_SECRET` | Authentication | Configured | 64-char random development secret |
| `JWT_EXPIRES_IN` | Authentication | Configured | Token expiration window (`15m`) |
| `REFRESH_TOKEN_SECRET`| Authentication | Configured | Refresh token development secret |
| `REFRESH_TOKEN_EXPIRES_IN`| Authentication | Configured | Refresh token window (`7d`) |
| `CHAIN_ID` | Blockchain | Configured | Active chain ID (`11155111` for Sepolia) |
| `RPC_URL` | Blockchain | Configured | Sepolia RPC provider endpoint |
| `LOCAL_RPC_URL` | Blockchain | Configured | Hardhat JSON-RPC endpoint (`http://127.0.0.1:8545`) |
| `CONTRACT_ADDRESS` | Blockchain | Placeholder | Deployed contract placeholder (`0x00...00`) |
| `RELAYER_PRIVATE_KEY`| Blockchain | Placeholder | Relayer testnet key placeholder (Never commit real keys!) |
| `ETHERSCAN_API_KEY` | Blockchain | Placeholder | Verification API key placeholder |
| `BLOCK_EXPLORER_BASE_URL`| Blockchain | Configured | Explorer base link (`https://sepolia.etherscan.io`) |
| `FRONTEND_URL` | Network | Configured | Client CORS origin (`http://localhost:5173`) |
| `BACKEND_URL` | Network | Configured | API base URL (`http://localhost:4000`) |
| `STORAGE_DRIVER` | File Storage | Configured | Storage provider (`local`) |
| `LOCAL_STORAGE_PATH`| File Storage | Configured | Ephemeral/local storage path (`./temp/storage`) |
| `MAX_FILE_SIZE_BYTES`| File Storage | Configured | Upload limit (`26214400` = 25 MB) |
| `CONFIRMATION_THRESHOLD_SEPOLIA` | Blockchain | Configured | Sepolia confirmation count (`2`) |
| `CONFIRMATION_THRESHOLD_HARDHAT` | Blockchain | Configured | Hardhat local confirmation count (`1`) |

---

## 3. Connectivity Handshake Test Suite Results

All tests executed using [`tools/check_connectivity.py`](file:///d:/Project/bitmob/tools/check_connectivity.py), Docker CLI, and PostgreSQL CLI queries.

### Test Matrix

| Test ID | Target Service | Purpose | Command / Tool | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-LINK-01** | Local PostgreSQL Service | Verify socket on `127.0.0.1:5432` | `tools/check_connectivity.py` | Port open & listening | Port 5432 is OPEN and listening | ✅ **PASS** |
| **TC-LINK-01A**| Container Healthcheck | Verify docker health status | `docker ps --filter name=proofvault-postgres` | Container status `healthy` | `Up (healthy)`, port `127.0.0.1:5432->5432/tcp` | ✅ **PASS** |
| **TC-LINK-01B**| Persistent Volume Mount | Verify named persistent volume | `docker inspect proofvault-postgres` | Volume `proofvault_pgdata` mounted | Volume `proofvault_pgdata` mounted at `/var/lib/postgresql/data` | ✅ **PASS** |
| **TC-LINK-01C**| Localhost-Only Port Binding| Verify socket is restricted to loopback | `Get-NetTCPConnection -LocalPort 5432` | LocalAddress `127.0.0.1` | `127.0.0.1:5432 Listen` | ✅ **PASS** |
| **TC-LINK-01D**| Engine Version Check | Verify PostgreSQL version | `psql -c "SELECT version();"` | PostgreSQL 16.x | `PostgreSQL 16.15 on x86_64-pc-linux-musl` | ✅ **PASS** |
| **TC-LINK-01E**| Application User Auth & Query | Verify real DB connection & query | `psql -U proofvault_user -d proofvault_db -c "SELECT 1;"` | Query returns integer `1` | `healthcheck_result: 1` (`1 row`) | ✅ **PASS** |
| **TC-LINK-02** | Local Hardhat RPC | Verify JSON-RPC on port 8545 | `tools/check_connectivity.py` | Chain ID `31337` on `8545` | Port 8545 closed (Node to launch in Phase 3) | ⚠️ **BLOCKED** |
| **TC-LINK-03** | Ethereum Sepolia Public RPC | Verify public testnet read-only RPC | `tools/check_connectivity.py` | Chain ID `11155111` | Chain ID `11155111`, Block `11893294` | ✅ **PASS** |
| **TC-LINK-04** | Secrets Exposure Audit | Verify untracked credentials & ignore rules | Filesystem scan & ignore audit | Zero leaks; `.env` excluded | `.gitignore` excludes `.env`; zero secrets exposed | ✅ **PASS** |

---

## 4. Verification Evidence & Artifacts

### 4.1 Container & Port Evidence
```
CONTAINER ID   NAMES                 STATUS                        PORTS
5712000465dd   proofvault-postgres   Up About a minute (healthy)   127.0.0.1:5432->5432/tcp
```

### 4.2 Localhost-Only Binding Evidence
```
LocalAddress LocalPort State
------------ --------- -----
127.0.0.1    5432      Listen
```

### 4.3 Named Volume Evidence
```json
[
  {
    "Type": "volume",
    "Name": "proofvault_pgdata",
    "Source": "/var/lib/docker/volumes/proofvault_pgdata/_data",
    "Destination": "/var/lib/postgresql/data",
    "Driver": "local",
    "Mode": "rw",
    "RW": true
  }
]
```

### 4.4 PostgreSQL Version & `SELECT 1;` Query Execution
```
psql -U proofvault_user -d proofvault_db -c "SELECT version();"
                                         version                                          
------------------------------------------------------------------------------------------
 PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit
(1 row)

psql -U proofvault_user -d proofvault_db -c "SELECT 1 AS healthcheck_result;"
 healthcheck_result 
--------------------
                  1
(1 row)
```

---

## 5. Security & Boundary Compliance

- **No Application Code:** Zero application models, routes, or tables created.
- **No Migrations:** Database remains clean; Prisma migrations deferred to Phase 3.
- **No Git Manipulation:** Git was not initialized; no GitHub repositories created.
- **Credential Protection:** All credentials reside in untracked `.env` protected by `.gitignore` and `.dockerignore`.
