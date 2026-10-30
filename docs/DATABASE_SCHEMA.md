# ProofVault — Database Schema Reference

This document points to the database persistence architecture and migration history for ProofVault.

- **Prisma Schema & Entity Relationships:** See [DATA_SCHEMA.md](DATA_SCHEMA.md).
- **Primary Prisma File:** [schema.prisma](../proofvault-backend/prisma/schema.prisma).
- **Core Models:** `User`, `Document`, `BlockchainRegistration`, `TransactionOperation`, `AuditLog`, `DocumentPermission`, `RefreshToken`.
- **Active Migrations:** `proofvault-backend/prisma/migrations/20261013141639_init_core_schema`.
- **Database Engine:** PostgreSQL 16 Alpine via Docker Compose.
