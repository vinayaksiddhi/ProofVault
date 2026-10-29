import { expect } from "chai";
import { blockchainService } from "../src/services/blockchain.service";
import {
  deriveDocumentKey,
  formatBytes32,
  computeSha256,
} from "../src/utils/crypto.utils";
import { config } from "../src/config";
import { clearTestData, SAMPLE_BUFFERS } from "./helpers/test-setup";
import { prisma } from "../src/db/client";
import { Role, UserStatus, TxStatus, AuditEventType } from "@prisma/client";
import { auditService } from "../src/services/audit.service";

describe("5. Blockchain Integration, Reconciliation & Secret Redaction", () => {
  before(async () => {
    await clearTestData();
  });

  after(async () => {
    await clearTestData();
  });

  it("5.1 should deterministically derive documentKey using keccak256(bytes(documentId))", () => {
    const docId = "c8b417e8-97fb-4927-9c94-8ef86ca6ad10";
    const derivedKey = deriveDocumentKey(docId);

    expect(derivedKey).to.be.a("string");
    expect(derivedKey).to.match(/^0x[a-f0-9]{64}$/i);
    // Deterministic check
    expect(derivedKey).to.equal(deriveDocumentKey(docId));
  });

  it("5.2 should format canonical 64-character SHA-256 into bytes32 0x-prefixed hex string", () => {
    const rawSha256 = computeSha256(SAMPLE_BUFFERS.validPdf);
    const bytes32Hex = formatBytes32(rawSha256);

    expect(bytes32Hex).to.equal(`0x${rawSha256}`);
    expect(bytes32Hex).to.have.lengthOf(66);
  });

  it("5.3 should perform non-mutating pre-flight check returning false for unregistered documentKey", async () => {
    const randomKey = deriveDocumentKey("unregistered-doc-id");
    const preFlight = await blockchainService.preFlightCheck(randomKey);

    expect(preFlight.exists).to.be.false;
  });

  it("5.4 should verify BlockchainRegistration model tracks revocation state consistently", async () => {
    const user = await prisma.user.create({
      data: {
        email: "relayer-test@proofvault.io",
        passwordHash: "$2a$12$samplepasswordhashfortestingonly999",
        role: Role.USER,
        status: UserStatus.ACTIVE,
      },
    });

    const doc = await prisma.document.create({
      data: {
        ownerId: user.id,
        title: "Relayer Test Document",
        originalFileName: "relayer.pdf",
        mimeType: "application/pdf",
        fileSize: BigInt(500),
        storageKey: "doc_relayer_test.bin",
        sha256Hash: computeSha256(SAMPLE_BUFFERS.validPdf),
      },
    });

    const docKey = deriveDocumentKey(doc.id);
    const docHash = formatBytes32(doc.sha256Hash);

    // Create registration record
    const registration = await prisma.blockchainRegistration.create({
      data: {
        documentId: doc.id,
        chainId: BigInt(31337),
        contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        documentKey: docKey,
        documentHash: docHash,
        issuerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        transactionHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        status: TxStatus.CONFIRMED,
        isRevoked: false,
      },
    });

    expect(registration.isRevoked).to.be.false;

    // Simulate revocation
    const revokeDate = new Date();
    const updated = await prisma.blockchainRegistration.update({
      where: { id: registration.id },
      data: {
        isRevoked: true,
        revokedAt: revokeDate,
        revocationReason: "Superseded by updated agreement v2",
      },
    });

    expect(updated.isRevoked).to.be.true;
    expect(updated.revocationReason).to.equal("Superseded by updated agreement v2");
    expect(updated.revokedAt).to.not.be.null;
  });

  it("5.5 should verify reconciliation boundaries: pending transaction with missing receipt does not mark confirmed", async () => {
    const nonExistentTx = "0x9999999999999999999999999999999999999999999999999999999999999999";
    const testKey = deriveDocumentKey("test-reconciliation");
    const testHash = formatBytes32(computeSha256(SAMPLE_BUFFERS.validPdf));

    const reconciliation = await blockchainService.reconcileTransaction(
      nonExistentTx,
      testKey,
      testHash
    );

    // Must be false: pending or missing receipt must never be assumed confirmed (Decision Q4 & Q6)
    expect(reconciliation.confirmed).to.be.false;
  });

  it("5.6 should enforce secret redaction in audit logging (SOP-ARCH-003)", async () => {
    const testRequestId = "req-redaction-test";

    // Attempt to log an event with sensitive keys in metadata
    await auditService.record({
      actorUserId: null,
      eventType: AuditEventType.BLOCKCHAIN_SUBMITTED,
      result: "SUCCESS",
      requestId: testRequestId,
      metadata: {
        safeField: "safeValue",
        password: "MySecretPassword123!",
        privateKey: config.relayerPrivateKey,
        jwtSecret: config.jwtSecret,
      },
    });

    const logged = await prisma.auditLog.findFirst({
      where: { requestId: testRequestId },
    });

    expect(logged).to.not.be.null;
    const meta = logged?.metadata as any;
    expect(meta.safeField).to.equal("safeValue");
    // Secrets must be cleanly redacted
    expect(meta.password).to.equal("[REDACTED]");
    expect(meta.privateKey).to.equal("[REDACTED]");
    expect(meta.jwtSecret).to.equal("[REDACTED]");
  });
});
