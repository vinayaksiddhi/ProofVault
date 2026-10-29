# Layer 1: Architecture SOPs (The "How-To")
**A.N.T. Three-Layer Architecture: Layer 1**

These technical Standard Operating Procedures (SOPs) define the deterministic business rules, data schemas, security boundaries, and fault-tolerance protocols for ProofVault before implementation code is written.

> **The Golden Rule:** If business logic changes, update the relevant SOP in this directory before updating the code in `tools/` or application services.

---

## Technical SOP Index

1. [`SOP_DOCUMENT_LIFECYCLE.md`](file:///d:/Project/bitmob/architecture/SOP_DOCUMENT_LIFECYCLE.md)  
   *Specification of document ingestion, magic-byte checking, canonical SHA-256 stream hashing, private storage, deduplication, on-chain anchoring, verification, revocation, and deletion.*

2. [`SOP_TRANSACTION_RECONCILIATION.md`](file:///d:/Project/bitmob/architecture/SOP_TRANSACTION_RECONCILIATION.md)  
   *Specification of asynchronous blockchain handling, relayer nonce mutex locks, timeout $\neq$ failure axioms, contract pre-flight reads, 15% gas bumping, and self-healing crash recovery.*

3. [`SOP_SECURITY_AND_PRIVACY.md`](file:///d:/Project/bitmob/architecture/SOP_SECURITY_AND_PRIVACY.md)  
   *Specification of secret management, relayer key isolation, BOLA/IDOR prevention, storage obfuscation, and zero-leakage public verification DTO filtering.*
