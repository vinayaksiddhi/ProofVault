import { expect } from "chai";
import { ethers, Interface } from "ethers";
import { blockchainService } from "../src/services/blockchain.service";
import ProofVaultArtifact from "../src/contracts/ProofVault.abi.json";
import { deriveDocumentKey, formatBytes32 } from "../src/utils/crypto.utils";

describe("7. Receipt Validation & Event Verification (Stage 3 Remediation)", () => {
  const iface = new Interface(ProofVaultArtifact.abi);
  const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const expectedDocKey = deriveDocumentKey("test-receipt-doc-12345");
  const expectedDocHash = formatBytes32("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const relayerAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  // Helper to create synthetic receipt
  function createMockReceipt(overrides: {
    status?: number;
    to?: string;
    logs?: Array<{ address: string; topics: string[]; data: string }>;
    blockNumber?: number;
  }): any {
    return {
      status: overrides.status ?? 1,
      to: overrides.to ?? contractAddress,
      from: relayerAddress,
      blockNumber: overrides.blockNumber ?? 42,
      hash: "0x" + "a".repeat(64),
      logs: overrides.logs ?? [],
    };
  }

  it("7.1 should reject null or undefined receipts", () => {
    const resNull = blockchainService.verifyReceiptAndEvent(null, expectedDocKey, expectedDocHash);
    expect(resNull.isValid).to.be.false;
    expect(resNull.reason).to.equal("RECEIPT_NULL_OR_UNDEFINED");

    const resUndef = blockchainService.verifyReceiptAndEvent(undefined, expectedDocKey, expectedDocHash);
    expect(resUndef.isValid).to.be.false;
    expect(resUndef.reason).to.equal("RECEIPT_NULL_OR_UNDEFINED");
  });

  it("7.2 should reject reverted receipts with status 0", () => {
    const receipt = createMockReceipt({ status: 0 });
    const res = blockchainService.verifyReceiptAndEvent(receipt, expectedDocKey, expectedDocHash, contractAddress);
    expect(res.isValid).to.be.false;
    expect(res.reason).to.equal("TRANSACTION_REVERTED_STATUS_ZERO");
  });

  it("7.3 should reject receipts with destination contract address mismatch", () => {
    const wrongContract = "0x1111111111111111111111111111111111111111";
    const receipt = createMockReceipt({ to: wrongContract });
    const res = blockchainService.verifyReceiptAndEvent(receipt, expectedDocKey, expectedDocHash, contractAddress);
    expect(res.isValid).to.be.false;
    expect(res.reason).to.equal("DESTINATION_CONTRACT_MISMATCH");
  });

  it("7.4 should reject receipts with empty event logs (zero unconditional fallback)", () => {
    const receipt = createMockReceipt({ logs: [] });
    const res = blockchainService.verifyReceiptAndEvent(receipt, expectedDocKey, expectedDocHash, contractAddress);
    expect(res.isValid).to.be.false;
    expect(res.reason).to.equal("EMPTY_EVENT_LOGS");
  });

  it("7.5 should reject receipts containing unrelated contract events (e.g. DocumentRevoked)", () => {
    // Encode DocumentRevoked event instead of DocumentRegistered
    const revokedLogData = iface.encodeEventLog(
      iface.getEvent("DocumentRevoked")!,
      [expectedDocKey, relayerAddress, BigInt(1700000000), "Revocation test"]
    );

    const receipt = createMockReceipt({
      logs: [
        {
          address: contractAddress,
          topics: revokedLogData.topics as string[],
          data: revokedLogData.data,
        },
      ],
    });

    const res = blockchainService.verifyReceiptAndEvent(receipt, expectedDocKey, expectedDocHash, contractAddress);
    expect(res.isValid).to.be.false;
    expect(res.reason).to.equal("NO_DOCUMENT_REGISTERED_EVENT_FOUND");
  });

  it("7.6 should reject receipts where DocumentRegistered has a mismatched documentKey", () => {
    const mismatchedKey = deriveDocumentKey("different-document-id");
    const regLogData = iface.encodeEventLog(
      iface.getEvent("DocumentRegistered")!,
      [mismatchedKey, expectedDocHash, relayerAddress, BigInt(1700000000)]
    );

    const receipt = createMockReceipt({
      logs: [
        {
          address: contractAddress,
          topics: regLogData.topics as string[],
          data: regLogData.data,
        },
      ],
    });

    const res = blockchainService.verifyReceiptAndEvent(receipt, expectedDocKey, expectedDocHash, contractAddress);
    expect(res.isValid).to.be.false;
    expect(res.reason).to.include("DOCUMENT_KEY_MISMATCH");
  });

  it("7.7 should reject receipts where DocumentRegistered has a mismatched documentHash", () => {
    const mismatchedHash = formatBytes32("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const regLogData = iface.encodeEventLog(
      iface.getEvent("DocumentRegistered")!,
      [expectedDocKey, mismatchedHash, relayerAddress, BigInt(1700000000)]
    );

    const receipt = createMockReceipt({
      logs: [
        {
          address: contractAddress,
          topics: regLogData.topics as string[],
          data: regLogData.data,
        },
      ],
    });

    const res = blockchainService.verifyReceiptAndEvent(receipt, expectedDocKey, expectedDocHash, contractAddress);
    expect(res.isValid).to.be.false;
    expect(res.reason).to.include("DOCUMENT_HASH_MISMATCH");
  });

  it("7.8 should reject receipts where log emitter address does not match contractAddress", () => {
    const wrongEmitter = "0x9999999999999999999999999999999999999999";
    const regLogData = iface.encodeEventLog(
      iface.getEvent("DocumentRegistered")!,
      [expectedDocKey, expectedDocHash, relayerAddress, BigInt(1700000000)]
    );

    const receipt = createMockReceipt({
      logs: [
        {
          address: wrongEmitter, // Log emitted by a spoofed contract
          topics: regLogData.topics as string[],
          data: regLogData.data,
        },
      ],
    });

    const res = blockchainService.verifyReceiptAndEvent(receipt, expectedDocKey, expectedDocHash, contractAddress);
    expect(res.isValid).to.be.false;
    expect(res.reason).to.equal("NO_DOCUMENT_REGISTERED_EVENT_FOUND");
  });

  it("7.9 should confirm receipts containing valid, matching DocumentRegistered event", () => {
    const regLogData = iface.encodeEventLog(
      iface.getEvent("DocumentRegistered")!,
      [expectedDocKey, expectedDocHash, relayerAddress, BigInt(1700000000)]
    );

    const receipt = createMockReceipt({
      blockNumber: 105,
      logs: [
        {
          address: contractAddress,
          topics: regLogData.topics as string[],
          data: regLogData.data,
        },
      ],
    });

    const res = blockchainService.verifyReceiptAndEvent(receipt, expectedDocKey, expectedDocHash, contractAddress);
    expect(res.isValid).to.be.true;
    expect(res.documentKey).to.equal(expectedDocKey.toLowerCase());
    expect(res.documentHash).to.equal(expectedDocHash.toLowerCase());
    expect(res.issuer?.toLowerCase()).to.equal(relayerAddress.toLowerCase());
    expect(res.registeredAt).to.equal(1700000000);
    expect(res.blockNumber).to.equal(105);
  });
});
