# ProofVault — Blockchain Layer (`proofvault-blockchain`)

## 1. Overview
The `proofvault-blockchain` package contains the Solidity smart contracts, Hardhat configuration, unit and security tests, and deployment scripts for ProofVault. It implements Layer 3 deterministic contract logic within the A.N.T. architecture.

## 2. Smart Contract: `ProofVault.sol`
- **Solidity Version:** `0.8.24`
- **Inheritance:** `IProofVault`, OpenZeppelin `Ownable2Step`
- **Key Features:**
  - `registerDocument(bytes32 documentKey, bytes32 documentHash)`: Anchors canonical document SHA-256 fingerprint on-chain under unique key. Reverts on zero keys, zero hashes, or duplicates. Restricted to authorized registrars (backend relayer) or contract owner.
  - `verifyDocument(bytes32 documentKey, bytes32 candidateHash)`: Pure view verification returning boolean match, registration timestamp, issuer address, revocation status, and revocation timestamp.
  - `getDocument(bytes32 documentKey)`: Direct view lookup for registered proof records.
  - `revokeDocument(bytes32 documentKey, string calldata reason)`: Allows original issuer or contract owner to flag a document as revoked. Emits `DocumentRevoked` with reason in event only (does not store string in storage to optimize gas). Reverts if reason exceeds 256 UTF-8 bytes.
  - `setRegistrar(address registrar, bool authorized)`: Allows contract owner to authorize or revoke relayer/registrar addresses.

## 3. Toolchain & Dependencies
- **Node.js:** `v25.2.1` (Host runtime; Hardhat prints informational non-LTS warning, but executes cleanly)
- **Hardhat:** `^2.22.18`
- **OpenZeppelin Contracts:** `@openzeppelin/contracts@^5.0.2`
- **Ethers.js:** `^6.13.4`
- **Solidity Coverage:** `^0.8.12`

## 4. Local Verification & Test Commands
```bash
# Compile contracts
npx hardhat compile

# Run full test suite (24 tests)
npx hardhat test

# Run code coverage (100% statements, branch, functions, lines)
npx hardhat coverage

# Run local deployment & basic operation verification script
npx hardhat run scripts/deploy.ts --network hardhat
```

## 5. Measured Gas Benchmarks
- `registerDocument`: $\approx 96,152 - 96,164$ gas units (includes cold SSTORE for struct and total counter)
- `revokeDocument`: $\approx 53,281 - 54,895$ gas units
