import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ProofVault } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ProofVault Smart Contract Test Suite", function () {
  let proofVault: ProofVault;
  let owner: SignerWithAddress;
  let relayer: SignerWithAddress;
  let unauthorizedUser: SignerWithAddress;
  let recipient: SignerWithAddress;

  // Test Fixture Data
  const sampleDocumentKey = ethers.keccak256(ethers.toUtf8Bytes("doc-uuid-12345-abcde"));
  const sampleDocumentHash = ethers.keccak256(ethers.toUtf8Bytes("file-bytes-content-sample-pdf"));
  const candidateAlteredHash = ethers.keccak256(ethers.toUtf8Bytes("altered-file-bytes-different"));
  const zeroBytes32 = ethers.ZeroHash;

  beforeEach(async function () {
    [owner, relayer, unauthorizedUser, recipient] = await ethers.getSigners();

    const ProofVaultFactory = await ethers.getContractFactory("ProofVault");
    proofVault = await ProofVaultFactory.deploy(owner.address);
    await proofVault.waitForDeployment();

    // Authorize the relayer
    await proofVault.connect(owner).setRegistrar(relayer.address, true);
  });

  describe("1. Ownership & Initialization", function () {
    it("1.1 should correctly initialize owner and authorized registrar", async function () {
      expect(await proofVault.owner()).to.equal(owner.address);
      expect(await proofVault.isAuthorizedRegistrar(owner.address)).to.be.true;
      expect(await proofVault.isAuthorizedRegistrar(relayer.address)).to.be.true;
      expect(await proofVault.isAuthorizedRegistrar(unauthorizedUser.address)).to.be.false;
      expect(await proofVault.totalDocumentsRegistered()).to.equal(0);
    });

    it("1.2 should allow owner to manage registrars and reject unauthorized updates", async function () {
      await expect(proofVault.connect(unauthorizedUser).setRegistrar(recipient.address, true))
        .to.be.revertedWithCustomError(proofVault, "OwnableUnauthorizedAccount")
        .withArgs(unauthorizedUser.address);

      await expect(proofVault.connect(owner).setRegistrar(recipient.address, true))
        .to.emit(proofVault, "RegistrarUpdated")
        .withArgs(recipient.address, true);

      expect(await proofVault.isAuthorizedRegistrar(recipient.address)).to.be.true;

      // De-authorize
      await expect(proofVault.connect(owner).setRegistrar(recipient.address, false))
        .to.emit(proofVault, "RegistrarUpdated")
        .withArgs(recipient.address, false);

      expect(await proofVault.isAuthorizedRegistrar(recipient.address)).to.be.false;
    });

    it("1.3 should execute two-step ownership transfer (Ownable2Step)", async function () {
      // Step 1: Propose transfer
      await proofVault.connect(owner).transferOwnership(recipient.address);
      expect(await proofVault.pendingOwner()).to.equal(recipient.address);
      expect(await proofVault.owner()).to.equal(owner.address);

      // Step 2: Accept transfer
      await proofVault.connect(recipient).acceptOwnership();
      expect(await proofVault.owner()).to.equal(recipient.address);
      expect(await proofVault.pendingOwner()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("2. Document Registration", function () {
    it("2.1 should register a document successfully and emit DocumentRegistered", async function () {
      const tx = await proofVault.connect(relayer).registerDocument(sampleDocumentKey, sampleDocumentHash);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);

      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const expectedTimestamp = block!.timestamp;

      await expect(tx)
        .to.emit(proofVault, "DocumentRegistered")
        .withArgs(sampleDocumentKey, sampleDocumentHash, relayer.address, expectedTimestamp);

      expect(await proofVault.totalDocumentsRegistered()).to.equal(1);
    });

    it("2.2 should reject registration with zero document key", async function () {
      await expect(
        proofVault.connect(relayer).registerDocument(zeroBytes32, sampleDocumentHash)
      ).to.be.revertedWithCustomError(proofVault, "InvalidDocumentKey");
    });

    it("2.3 should reject registration with zero document hash", async function () {
      await expect(
        proofVault.connect(relayer).registerDocument(sampleDocumentKey, zeroBytes32)
      ).to.be.revertedWithCustomError(proofVault, "InvalidDocumentHash");
    });

    it("2.4 should reject duplicate registration with the same document key", async function () {
      await proofVault.connect(relayer).registerDocument(sampleDocumentKey, sampleDocumentHash);

      await expect(
        proofVault.connect(relayer).registerDocument(sampleDocumentKey, sampleDocumentHash)
      )
        .to.be.revertedWithCustomError(proofVault, "DocumentKeyAlreadyRegistered")
        .withArgs(sampleDocumentKey);
    });

    it("2.5 should reject registration from unauthorized caller", async function () {
      await expect(
        proofVault.connect(unauthorizedUser).registerDocument(sampleDocumentKey, sampleDocumentHash)
      )
        .to.be.revertedWithCustomError(proofVault, "NotAuthorizedRegistrar")
        .withArgs(unauthorizedUser.address);
    });

    it("2.6 should allow the contract owner to register directly", async function () {
      const ownerKey = ethers.keccak256(ethers.toUtf8Bytes("owner-doc-001"));
      const tx = await proofVault.connect(owner).registerDocument(ownerKey, sampleDocumentHash);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(proofVault, "DocumentRegistered")
        .withArgs(ownerKey, sampleDocumentHash, owner.address, block!.timestamp);
    });
  });

  describe("3. Document Verification & Lookup", function () {
    beforeEach(async function () {
      await proofVault.connect(relayer).registerDocument(sampleDocumentKey, sampleDocumentHash);
    });

    it("3.1 should return successful match for exact document hash", async function () {
      const [isMatch, registeredAt, issuer, isRevoked, revokedAt] = await proofVault.verifyDocument(
        sampleDocumentKey,
        sampleDocumentHash
      );

      expect(isMatch).to.be.true;
      expect(registeredAt).to.be.gt(0);
      expect(issuer).to.equal(relayer.address);
      expect(isRevoked).to.be.false;
      expect(revokedAt).to.equal(0);
    });

    it("3.2 should return match = false for altered document hash", async function () {
      const [isMatch, registeredAt, issuer, isRevoked, revokedAt] = await proofVault.verifyDocument(
        sampleDocumentKey,
        candidateAlteredHash
      );

      expect(isMatch).to.be.false;
      expect(registeredAt).to.be.gt(0);
      expect(issuer).to.equal(relayer.address);
      expect(isRevoked).to.be.false;
      expect(revokedAt).to.equal(0);
    });

    it("3.3 should return deterministic non-reverting zero values for unregistered document verification", async function () {
      const unregisteredKey = ethers.keccak256(ethers.toUtf8Bytes("non-existent-key"));
      const [isMatch, registeredAt, issuer, isRevoked, revokedAt] = await proofVault.verifyDocument(
        unregisteredKey,
        sampleDocumentHash
      );

      expect(isMatch).to.be.false;
      expect(registeredAt).to.equal(0);
      expect(issuer).to.equal(ethers.ZeroAddress);
      expect(isRevoked).to.be.false;
      expect(revokedAt).to.equal(0);
    });

    it("3.4 should lookup existing document details via getDocument", async function () {
      const [docHash, registeredAt, issuer, isRevoked, revokedAt] = await proofVault.getDocument(sampleDocumentKey);

      expect(docHash).to.equal(sampleDocumentHash);
      expect(registeredAt).to.be.gt(0);
      expect(issuer).to.equal(relayer.address);
      expect(isRevoked).to.be.false;
      expect(revokedAt).to.equal(0);
    });

    it("3.5 should return zero values for getDocument on unregistered key", async function () {
      const unregisteredKey = ethers.keccak256(ethers.toUtf8Bytes("missing-key"));
      const [docHash, registeredAt, issuer, isRevoked, revokedAt] = await proofVault.getDocument(unregisteredKey);

      expect(docHash).to.equal(ethers.ZeroHash);
      expect(registeredAt).to.equal(0);
      expect(issuer).to.equal(ethers.ZeroAddress);
      expect(isRevoked).to.be.false;
      expect(revokedAt).to.equal(0);
    });

    it("3.6 should verify that registered active document returns isRevoked = false and non-zero hash", async function () {
      const [docHash, registeredAt, issuer, isRevoked, revokedAt] = await proofVault.getDocument(sampleDocumentKey);
      expect(docHash).to.not.equal(ethers.ZeroHash);
      expect(registeredAt).to.be.gt(0);
      expect(isRevoked).to.be.false;
      expect(revokedAt).to.equal(0);
    });
  });

  describe("4. Document Revocation", function () {
    const reasonText = "Formal revocation: contract cancelled by mutual agreement.";

    beforeEach(async function () {
      await proofVault.connect(relayer).registerDocument(sampleDocumentKey, sampleDocumentHash);
    });

    it("4.1 should allow original issuer to revoke document and emit DocumentRevoked", async function () {
      const tx = await proofVault.connect(relayer).revokeDocument(sampleDocumentKey, reasonText);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(proofVault, "DocumentRevoked")
        .withArgs(sampleDocumentKey, relayer.address, block!.timestamp, reasonText);

      const record = await proofVault.getDocument(sampleDocumentKey);
      expect(record.isRevoked).to.be.true;
      expect(record.revokedAt).to.equal(block!.timestamp);
    });

    it("4.2 should allow contract owner to revoke document issued by relayer", async function () {
      const tx = await proofVault.connect(owner).revokeDocument(sampleDocumentKey, "Owner administrative revocation");
      await expect(tx).to.emit(proofVault, "DocumentRevoked");

      const record = await proofVault.getDocument(sampleDocumentKey);
      expect(record.isRevoked).to.be.true;
    });

    it("4.3 should reject revocation from unauthorized third party", async function () {
      await expect(
        proofVault.connect(unauthorizedUser).revokeDocument(sampleDocumentKey, "Malicious attempt")
      )
        .to.be.revertedWithCustomError(proofVault, "NotAuthorized")
        .withArgs(sampleDocumentKey, unauthorizedUser.address);
    });

    it("4.4 should reject revocation of non-existent document key", async function () {
      const unregisteredKey = ethers.keccak256(ethers.toUtf8Bytes("does-not-exist"));
      await expect(
        proofVault.connect(owner).revokeDocument(unregisteredKey, reasonText)
      )
        .to.be.revertedWithCustomError(proofVault, "DocumentNotFound")
        .withArgs(unregisteredKey);
    });

    it("4.5 should reject repeated revocation of already revoked document", async function () {
      await proofVault.connect(relayer).revokeDocument(sampleDocumentKey, reasonText);

      await expect(
        proofVault.connect(relayer).revokeDocument(sampleDocumentKey, "Second attempt")
      )
        .to.be.revertedWithCustomError(proofVault, "DocumentAlreadyRevoked")
        .withArgs(sampleDocumentKey);
    });

    it("4.6 should return match = false in verifyDocument after revocation even with exact hash", async function () {
      await proofVault.connect(relayer).revokeDocument(sampleDocumentKey, reasonText);

      const [isMatch, registeredAt, issuer, isRevoked, revokedAt] = await proofVault.verifyDocument(
        sampleDocumentKey,
        sampleDocumentHash
      );

      expect(isMatch).to.be.false; // Match is false because document is revoked!
      expect(registeredAt).to.be.gt(0);
      expect(issuer).to.equal(relayer.address);
      expect(isRevoked).to.be.true;
      expect(revokedAt).to.be.gt(0);
    });

    it("4.7 should reject revocation reason exceeding maximum byte length", async function () {
      const longReason = "A".repeat(257); // 257 bytes > MAX_REVOCATION_REASON_LENGTH (256)
      await expect(
        proofVault.connect(relayer).revokeDocument(sampleDocumentKey, longReason)
      )
        .to.be.revertedWithCustomError(proofVault, "RevocationReasonTooLong")
        .withArgs(257, 256);
    });

    it("4.8 should accept revocation reason of exactly maximum byte length", async function () {
      const exactMaxReason = "A".repeat(256);
      await expect(
        proofVault.connect(relayer).revokeDocument(sampleDocumentKey, exactMaxReason)
      ).to.emit(proofVault, "DocumentRevoked");
    });

    it("4.9 should confirm getDocument preserves documentHash and registeredAt after revocation", async function () {
      const [hashBefore, regTimeBefore] = await proofVault.getDocument(sampleDocumentKey);
      await proofVault.connect(relayer).revokeDocument(sampleDocumentKey, reasonText);

      const [docHash, registeredAt, issuer, isRevoked, revokedAt] = await proofVault.getDocument(sampleDocumentKey);
      expect(docHash).to.equal(hashBefore);
      expect(docHash).to.equal(sampleDocumentHash);
      expect(registeredAt).to.equal(regTimeBefore);
      expect(registeredAt).to.be.gt(0);
      expect(issuer).to.equal(relayer.address);
      expect(isRevoked).to.be.true;
      expect(revokedAt).to.be.gt(0);
    });
  });

  describe("5. Gas Benchmarks (Informational)", function () {
    it("5.1 should measure registration gas usage against target benchmark", async function () {
      const docKey = ethers.keccak256(ethers.toUtf8Bytes("gas-benchmark-doc-1"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("gas-benchmark-hash-1"));

      const tx = await proofVault.connect(relayer).registerDocument(docKey, docHash);
      const receipt = await tx.wait();

      console.log(`       Gas used for registerDocument: ${receipt?.gasUsed.toString()} units`);
      // Measured gas benchmark upper bound: <= 100,000 gas units
      expect(receipt?.gasUsed).to.be.lessThanOrEqual(100000n);
    });

    it("5.2 should measure revocation gas usage against target benchmark", async function () {
      const docKey = ethers.keccak256(ethers.toUtf8Bytes("gas-benchmark-doc-2"));
      const docHash = ethers.keccak256(ethers.toUtf8Bytes("gas-benchmark-hash-2"));

      await proofVault.connect(relayer).registerDocument(docKey, docHash);
      const tx = await proofVault.connect(relayer).revokeDocument(docKey, "Audit revocation benchmark");
      const receipt = await tx.wait();

      console.log(`       Gas used for revokeDocument: ${receipt?.gasUsed.toString()} units`);
      // Measured gas benchmark upper bound: <= 60,000 gas units
      expect(receipt?.gasUsed).to.be.lessThanOrEqual(60000n);
    });
  });
});
