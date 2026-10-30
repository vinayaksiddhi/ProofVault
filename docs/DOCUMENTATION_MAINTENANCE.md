# ProofVault — Documentation Maintenance Guide

Documentation is treated as a first-class engineering deliverable in ProofVault. Outdated documentation leads to operational failures and security vulnerabilities.

---

## 1. Golden Rules of Documentation

1. **Synchronized Updates:** Any pull request modifying API routes, Prisma schemas, smart contract interfaces, or environment configurations **must** update the corresponding documentation files in `docs/` and [README.md](../README.md).
2. **Verified Test Counts Only:** Never increment or state test counts or code coverage figures based on estimates. Only record counts from real, passing test runs.
3. **Architectural Decisions:** Any non-trivial technical decision (library changes, protocol upgrades, schema refactoring) must be logged in [DECISIONS.md](DECISIONS.md).
4. **No Automated Magic Assumptions:** Documentation is manually and deliberately maintained by engineers. Do not assume or promise that documentation is automatically kept up to date unless a dedicated automated CI pipeline is configured and verified.

---

## 2. Document Mapping

| Area | Primary Document | Secondary Reference |
| :--- | :--- | :--- |
| **System Overview & Quickstart** | `README.md` | `gemini.md` |
| **Architecture & Tiers** | `docs/ARCHITECTURE.md` | `docs/PHASE_3A_ARCHITECTURE_REVIEW.md` |
| **Development Setup** | `docs/DEVELOPMENT_SETUP.md` | `.env.example` |
| **API Endpoints & DTOs** | `docs/API_CONTRACTS.md` | `docs/API_REFERENCE.md` |
| **Smart Contracts & ABI** | `docs/BLOCKCHAIN_DESIGN.md` | `docs/SMART_CONTRACTS.md` |
| **Database & Migrations** | `docs/DATA_SCHEMA.md` | `docs/DATABASE_SCHEMA.md` |
| **Test Strategy & Suites** | `docs/TEST_STRATEGY.md` | `docs/TESTING.md` |
| **Threat Model & Security** | `docs/THREAT_MODEL.md` | `docs/SECURITY.md` |
| **Audit & Stabilization** | `docs/VERIFICATION_REPORT.md` | `docs/CHANGELOG.md` |

---

## 3. Maintenance Checklist for Releases

- [ ] Code builds cleanly without compiler errors (`npm run build` in backend and `npm run compile` in blockchain).
- [ ] Automated tests pass with 100% success rate on clean staging setup.
- [ ] New environment variables added to `.env.example` with clear comments.
- [ ] API endpoints documented in `docs/API_CONTRACTS.md`.
- [ ] Database migrations generated and tested against fresh PostgreSQL instance.
- [ ] Changelog updated in `docs/CHANGELOG.md`.
