// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IProofVault
 * @notice Interface for ProofVault cryptographic document integrity anchoring & verification
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

    /**
     * @notice Registers a document cryptographic fingerprint
     * @param documentKey Unique 32-byte identifier derived from keccak256(bytes(documentId))
     * @param documentHash Canonical SHA-256 digest of original raw file bytes
     */
    function registerDocument(bytes32 documentKey, bytes32 documentHash) external;

    /**
     * @notice Flags an existing document proof as revoked
     * @param documentKey The unique document key
     * @param reason Human-readable reason for revocation (emitted in event only)
     */
    function revokeDocument(bytes32 documentKey, string calldata reason) external;

    /**
     * @notice Authorizes or deauthorizes a registrar address (e.g. backend relayer)
     * @param registrar The address to authorize or revoke
     * @param authorized True to authorize, false to revoke
     */
    function setRegistrar(address registrar, bool authorized) external;

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
        returns (
            bool isMatch,
            uint64 registeredAt,
            address issuer,
            bool isRevoked,
            uint64 revokedAt
        );

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
        returns (
            bytes32 documentHash,
            uint64 registeredAt,
            address issuer,
            bool isRevoked,
            uint64 revokedAt
        );

    /**
     * @notice Check if an address is an authorized registrar
     */
    function isAuthorizedRegistrar(address registrar) external view returns (bool);
}
