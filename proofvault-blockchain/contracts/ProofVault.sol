// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./interfaces/IProofVault.sol";

/**
 * @title ProofVault
 * @notice Immutable, gas-optimized document proof registry for cryptographic integrity
 * @dev Implements A.N.T. Layer 3 deterministic contract logic with OpenZeppelin Ownable2Step
 */
contract ProofVault is IProofVault, Ownable2Step {
    /// @notice Maximum allowed UTF-8 byte length for revocation reason
    uint256 public constant MAX_REVOCATION_REASON_LENGTH = 256;

    struct DocumentRecord {
        bytes32 documentHash;   // SHA-256 digest of original raw document bytes
        uint64 registeredAt;    // Block timestamp when registered
        address issuer;         // Address that broadcast the registration (relayer or user)
        bool exists;            // Existence flag
        bool isRevoked;         // Revocation flag
        uint64 revokedAt;       // Block timestamp when revoked (0 if not revoked)
    }

    // Mapping: documentKey => DocumentRecord
    mapping(bytes32 => DocumentRecord) private _documents;

    // Mapping: registrar address => authorization status
    mapping(address => bool) private _authorizedRegistrars;

    // Total documents successfully anchored on-chain
    uint256 public totalDocumentsRegistered;

    /**
     * @notice Initializes ProofVault with an initial owner
     * @param initialOwner Address of the contract owner (granted default registrar role)
     */
    constructor(address initialOwner) Ownable(initialOwner) {
        _authorizedRegistrars[initialOwner] = true;
        emit RegistrarUpdated(initialOwner, true);
    }

    /**
     * @notice Registers a document cryptographic fingerprint
     * @dev Restricted to authorized registrars (e.g. backend relayer) or contract owner
     * @param documentKey Unique 32-byte identifier derived from keccak256(bytes(documentId))
     * @param documentHash Canonical SHA-256 digest of original file bytes
     */
    function registerDocument(bytes32 documentKey, bytes32 documentHash) external override {
        if (!_authorizedRegistrars[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedRegistrar(msg.sender);
        }
        if (documentKey == bytes32(0)) {
            revert InvalidDocumentKey();
        }
        if (documentHash == bytes32(0)) {
            revert InvalidDocumentHash();
        }
        if (_documents[documentKey].exists) {
            revert DocumentKeyAlreadyRegistered(documentKey);
        }

        uint64 currentTime = uint64(block.timestamp);
        _documents[documentKey] = DocumentRecord({
            documentHash: documentHash,
            registeredAt: currentTime,
            issuer: msg.sender,
            exists: true,
            isRevoked: false,
            revokedAt: 0
        });

        unchecked {
            totalDocumentsRegistered += 1;
        }

        emit DocumentRegistered(documentKey, documentHash, msg.sender, currentTime);
    }

    /**
     * @notice Flags an existing document proof as revoked
     * @dev Only callable by the original issuer or the contract owner
     * @param documentKey The unique document key
     * @param reason Human-readable reason for revocation (emitted in event only; not stored)
     */
    function revokeDocument(bytes32 documentKey, string calldata reason) external override {
        DocumentRecord storage record = _documents[documentKey];
        if (!record.exists) {
            revert DocumentNotFound(documentKey);
        }
        if (record.isRevoked) {
            revert DocumentAlreadyRevoked(documentKey);
        }
        if (msg.sender != record.issuer && msg.sender != owner()) {
            revert NotAuthorized(documentKey, msg.sender);
        }

        uint256 reasonLength = bytes(reason).length;
        if (reasonLength > MAX_REVOCATION_REASON_LENGTH) {
            revert RevocationReasonTooLong(reasonLength, MAX_REVOCATION_REASON_LENGTH);
        }

        uint64 currentTime = uint64(block.timestamp);
        record.isRevoked = true;
        record.revokedAt = currentTime;

        emit DocumentRevoked(documentKey, msg.sender, currentTime, reason);
    }

    /**
     * @notice Authorizes or deauthorizes a registrar address (e.g. backend relayer)
     * @dev Only callable by contract owner
     * @param registrar Address to authorize or deauthorize
     * @param authorized True to authorize, false to deauthorize
     */
    function setRegistrar(address registrar, bool authorized) external override onlyOwner {
        _authorizedRegistrars[registrar] = authorized;
        emit RegistrarUpdated(registrar, authorized);
    }

    /**
     * @notice Pure read-only verification comparing a candidate hash against the registered proof
     * @param documentKey The unique document key
     * @param candidateHash The SHA-256 hash to test against the registered proof
     * @return isMatch True if document exists, candidateHash matches registered hash, and not revoked
     * @return registeredAt Block timestamp of registration
     * @return issuer Address that submitted the registration
     * @return isRevoked True if the proof was formally revoked
     * @return revokedAt Block timestamp of revocation (0 if not revoked)
     */
    function verifyDocument(bytes32 documentKey, bytes32 candidateHash)
        external
        view
        override
        returns (
            bool isMatch,
            uint64 registeredAt,
            address issuer,
            bool isRevoked,
            uint64 revokedAt
        )
    {
        DocumentRecord storage record = _documents[documentKey];
        if (!record.exists) {
            return (false, 0, address(0), false, 0);
        }

        bool matchFound = (record.documentHash == candidateHash && !record.isRevoked);
        return (
            matchFound,
            record.registeredAt,
            record.issuer,
            record.isRevoked,
            record.revokedAt
        );
    }

    /**
     * @notice Direct record lookup for registered document
     * @param documentKey The unique document key
     * @return documentHash The registered SHA-256 digest
     * @return registeredAt Block timestamp of registration
     * @return issuer Address that submitted the registration
     * @return isRevoked True if revoked
     * @return revokedAt Block timestamp of revocation
     */
    function getDocument(bytes32 documentKey)
        external
        view
        override
        returns (
            bytes32 documentHash,
            uint64 registeredAt,
            address issuer,
            bool isRevoked,
            uint64 revokedAt
        )
    {
        DocumentRecord storage record = _documents[documentKey];
        if (!record.exists) {
            return (bytes32(0), 0, address(0), false, 0);
        }

        return (
            record.documentHash,
            record.registeredAt,
            record.issuer,
            record.isRevoked,
            record.revokedAt
        );
    }

    /**
     * @notice Check if an address is an authorized registrar
     * @param registrar Address to query
     * @return True if authorized, false otherwise
     */
    function isAuthorizedRegistrar(address registrar) external view override returns (bool) {
        return _authorizedRegistrars[registrar];
    }
}
