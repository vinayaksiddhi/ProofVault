# ProofVault — Security & Threat Model

This document outlines the security architecture, trust boundaries, and threat model for ProofVault.

- **Threat Model & Security Analysis:** See [THREAT_MODEL.md](THREAT_MODEL.md).
- **Security & Privacy SOP:** See [SOP_SECURITY_AND_PRIVACY.md](../architecture/SOP_SECURITY_AND_PRIVACY.md).
- **Core Security Controls:**
  1. Relayer private key isolation via environment configuration.
  2. Smart contract access control using OpenZeppelin `Ownable2Step`.
  3. Strict off-chain privacy: zero document bytes or PII stored on-chain.
  4. In-memory candidate file hashing during verification.
  5. In-memory nonce mutex to avoid relayer transaction collisions.
  6. Uniform HTTP 404 responses to eliminate document ID enumeration.
