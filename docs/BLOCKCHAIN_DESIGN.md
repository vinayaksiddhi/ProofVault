# ProofVault — Blockchain Design & Smart Contract Specification
**Document ID:** PV-CHAIN-001  
**Status:** PHASE 3B STAGE 1 IMPLEMENTED & LOCALLY VERIFIED  
**Last Updated:** 2026-10-12  

---

## 1. Network Strategy & Confirmation Finality

| Network | Chain ID | Purpose | Gas Asset | Finality Policy | Implementation Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hardhat Local** | `31337` | Deterministic unit & integration testing, rapid CI runs | Mock ETH | Configurable: `1` block (instant) | **Implemented & Verified** |
| **Ethereum Sepolia** | `11155111` | Public demonstration, live transaction verification, hackathon demo | Sepolia ETH (Faucet) | Configurable: `2` block confirmations (~24s) | Configured in `hardhat.config.ts` |
| **Ethereum Mainnet** | `1` | *Strictly out of scope for MVP* | Real ETH | N/A | Excluded |

---

## 2. Implemented Smart Contract: `ProofVault.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title IProofVault
 * @notice Deterministic, gas-optimized document proof registry
 */
interface IProofVault {
    // Custom Errors
    error InvalidDocumentKey();
    error InvalidDocumentHash();
    error DocumentKeyAlreadyRegistered(bytes32 documentKey);
    error DocumentNotFound(bytes32 documentKey);
    error NotAuthorized(bytes32 documentKey, address caller);
    error NotAuthorizedRegistrar(address caller);
    error DocumentAlreadyRevoked(bytes32 documentKey);
    error RevocationReasonTooLong(uint256 length, uint256 maxLength);

    // Events
    event DocumentRegistered(
        bytes32 indexed documentKey,
        bytes32 indexed documentHash,
        address indexed issuer,
        uint64 timestamp
    );

    event DocumentRevoked(
        bytes32 indexed documentKey,
        address indexed revoker,
        uint64 timestamp,
        string reason
    );

    event RegistrarUpdated(
        address indexed registrar,
        bool authorized
    );

    function registerDocument(bytes32 documentKey, bytes32 documentHash) external;
    function revokeDocument(bytes32 documentKey, string calldata reason) external;
    function setRegistrar(address registrar, bool authorized) external;

    function verifyDocument(bytes32 documentKey, bytes32 candidateHash)
        external
        view
        returns (
            bool isMatch,
            uint64 registeredAt,
            address issuer,
            bool isRevoked,
            uint64 revokedAt
        );

    function getDocument(bytes32 documentKey)
        external
        view
        returns (
            bytes32 documentHash,
            uint64 registeredAt,
            address issuer,
            bool isRevoked,
            uint64 revokedAt
        );

    function isAuthorizedRegistrar(address registrar) external view returns (bool);
}
```

### 2.1 Cryptographic Encodings
- **Document Hash:** Server computes canonical SHA-256 over raw file bytes. Output encoded as `bytes32 documentHash = bytes32(sha256Digest)` (`0x` + 64 hex characters). Reverts if `documentHash == bytes32(0)`.
- **Document Key:** Derived as `bytes32 documentKey = keccak256(bytes(documentId))` where `documentId` is the canonical UUID string. Reverts if `documentKey == bytes32(0)`.
- **Issuer Address Distinction:** The `issuer` recorded on-chain is the transaction sender (`msg.sender` = relayer wallet address in MVP), **not** the off-chain user account identity or email.

### 2.2 Access Control Model
1. **Authorized Registrar Role:** Registration is restricted to addresses authorized by the contract owner via `setRegistrar(address, bool)` or the owner directly. Reverts with `NotAuthorizedRegistrar(msg.sender)`.
2. **Revocation Authority:** Only the original `issuer` or the contract `owner` may call `revokeDocument`. Reverts with `NotAuthorized(documentKey, msg.sender)`.
3. **Reason Length Limit:** Revocation reasons are limited to $\le 256$ UTF-8 bytes to prevent block stuffing. Reverts with `RevocationReasonTooLong`. The reason string is emitted in `DocumentRevoked` and **not** stored in contract storage.
4. **Ownership:** Managed via OpenZeppelin `Ownable2Step` requiring explicit two-step transfer (`transferOwnership` + `acceptOwnership`).

### 2.3 Measured Gas Consumption Benchmarks
- **`registerDocument`:** `96,152 - 96,164` gas units (includes cold SSTORE for struct and total counter).
- **`revokeDocument`:** `53,281 - 54,895` gas units.

---

## 3. Test Coverage & Verification Results (Phase 3B Stage 1)

Executed via `npx hardhat test` and `npx hardhat coverage`:

```
-----------------------|----------|----------|----------|----------|----------------|
File                   |  % Stmts | % Branch |  % Funcs |  % Lines |Uncovered Lines |
-----------------------|----------|----------|----------|----------|----------------|
 contracts/            |      100 |      100 |      100 |      100 |                |
  ProofVault.sol       |      100 |      100 |      100 |      100 |                |
 contracts/interfaces/ |      100 |      100 |      100 |      100 |                |
  IProofVault.sol      |      100 |      100 |      100 |      100 |                |
-----------------------|----------|----------|----------|----------|----------------|
All files              |      100 |      100 |      100 |      100 |                |
-----------------------|----------|----------|----------|----------|----------------|
```

- **Total Test Cases:** 24 passing, 0 failing.
- **Local Deployment Check:** Executed via `scripts/deploy.ts` on ephemeral Hardhat network: contract deployed, owner verified, relayer authorized, test registration submitted (receipt status 1), and read-back verified.
