import { expect } from "chai";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/db/client";
import { reconciliationWorker } from "../src/workers/reconciliation.worker";
import { blockchainService } from "../src/services/blockchain.service";
import { coordinationService } from "../src/services/coordination.service";
import { clearTestData, SAMPLE_BUFFERS } from "./helpers/test-setup";
import { deriveDocumentKey, formatBytes32 } from "../src/utils/crypto.utils";
import { Role, UserStatus, TxStatus, RegistrationStatus } from "@prisma/client";

describe("6. Relayer & Reconciliation Engine (Stage 3)", () => {
  let userToken: string;
  let userId: string;

  before(async () => {
    await clearTestData();

    const regRes = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "relayer-worker@proofvault.io", password: "Password123!@#" });

    userToken = regRes.body.data.tokens.accessToken;
    userId = regRes.body.data.user.id;
  });

  after(async () => {
    await clearTestData();
  });

  describe("6.1 Distributed Locking & Nonce Coordination", () => {
    it("should prevent duplicate worker execution via PostgreSQL advisory lock", async () => {
      // 1. Acquire worker lock
      const acquired1 = await coordinationService.acquireWorkerLock();
      expect(acquired1).to.be.true;

      // 2. Second concurrent acquisition attempt must fail
      const acquired2 = await coordinationService.acquireWorkerLock();
      expect(acquired2).to.be.false;

      // 3. Release lock
      const released = await coordinationService.releaseWorkerLock();
      expect(released).to.be.true;

      // 4. Now lock can be acquired again
      const acquired3 = await coordinationService.acquireWorkerLock();
      expect(acquired3).to.be.true;
      await coordinationService.releaseWorkerLock();
    });

    it("should coordinate concurrent relayer executions serially via withRelayerLock", async () => {
      const executionOrder: number[] = [];

      const task1 = coordinationService.withRelayerLock(async () => {
        await new Promise((r) => setTimeout(r, 50));
        executionOrder.push(1);
        return 1;
      });

      const task2 = coordinationService.withRelayerLock(async () => {
        executionOrder.push(2);
        return 2;
      });

      const results = await Promise.all([task1, task2]);
      expect(results).to.deep.equal([1, 2]);
      expect(executionOrder).to.deep.equal([1, 2]);
    });
  });

  describe("6.2 Transaction Reconciliation Scenarios", () => {
    let testDocId: string;
    let testDocKey: string;
    let testDocHash: string;

    beforeEach(async () => {
      const doc = await prisma.document.create({
        data: {
          ownerId: userId,
          title: "Reconciliation Test Doc",
          originalFileName: "reconcile.pdf",
          mimeType: "application/pdf",
          fileSize: BigInt(512),
          storageKey: `doc_test_${Date.now()}.bin`,
          sha256Hash: "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
          registrationStatus: RegistrationStatus.SUBMITTED_TO_CHAIN,
        },
      });

      testDocId = doc.id;
      testDocKey = deriveDocumentKey(doc.id);
      testDocHash = formatBytes32(doc.sha256Hash);
    });

    it("should leave pending transaction in SUBMITTED state when receipt is missing (null)", async () => {
      const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      const op = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_pending`,
          txHash,
          nonce: 10,
          status: TxStatus.SUBMITTED,
          retryCount: 0,
        },
      });

      // Stub reconcileTransaction to simulate pending in mempool (receipt is null)
      const origReconcile = blockchainService.reconcileTransaction.bind(blockchainService);
      blockchainService.reconcileTransaction = async () => ({
        confirmed: false,
        reverted: false,
      });

      try {
        const stats = await reconciliationWorker.runOnce();
        expect(stats.confirmedCount).to.equal(0);
        expect(stats.revertedCount).to.equal(0);

        // Verify status remains SUBMITTED (Decision Q4: Timeout != Failure)
        const checkOp = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op.id },
        });
        expect(checkOp.status).to.equal(TxStatus.SUBMITTED);

        const checkDoc = await prisma.document.findUniqueOrThrow({
          where: { id: testDocId },
        });
        expect(checkDoc.registrationStatus).to.equal(RegistrationStatus.SUBMITTED_TO_CHAIN);
      } finally {
        blockchainService.reconcileTransaction = origReconcile;
      }
    });

    it("should recover and mark CONFIRMED when transaction was mined while backend was offline (Crash Recovery)", async () => {
      const txHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      const op = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_mined_offline`,
          txHash,
          nonce: 11,
          status: TxStatus.SUBMITTED,
        },
      });

      // Stub reconcileTransaction to simulate mined on-chain
      const origReconcile = blockchainService.reconcileTransaction.bind(blockchainService);
      blockchainService.reconcileTransaction = async () => ({
        confirmed: true,
        reverted: false,
        blockNumber: 12345n,
        blockTimestamp: new Date(),
      });

      try {
        const stats = await reconciliationWorker.runOnce();
        expect(stats.confirmedCount).to.be.greaterThan(0);

        // Verify database state transitioned to CONFIRMED
        const checkOp = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op.id },
        });
        expect(checkOp.status).to.equal(TxStatus.CONFIRMED);

        const checkDoc = await prisma.document.findUniqueOrThrow({
          where: { id: testDocId },
        });
        expect(checkDoc.registrationStatus).to.equal(RegistrationStatus.CONFIRMED_ON_CHAIN);

        // Verify BlockchainRegistration row was created and confirmed
        const reg = await prisma.blockchainRegistration.findFirst({
          where: { documentId: testDocId },
        });
        expect(reg).to.not.be.null;
        expect(reg?.status).to.equal(TxStatus.CONFIRMED);
      } finally {
        blockchainService.reconcileTransaction = origReconcile;
      }
    });

    it("should mark FAILED and REGISTRATION_FAILED when transaction receipt reverts (status 0)", async () => {
      const txHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

      const op = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_reverted`,
          txHash,
          nonce: 12,
          status: TxStatus.SUBMITTED,
        },
      });

      // Stub reconcileTransaction to simulate reverted receipt
      const origReconcile = blockchainService.reconcileTransaction.bind(blockchainService);
      blockchainService.reconcileTransaction = async () => ({
        confirmed: false,
        reverted: true,
      });

      try {
        const stats = await reconciliationWorker.runOnce();
        expect(stats.revertedCount).to.be.greaterThan(0);

        const checkOp = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op.id },
        });
        expect(checkOp.status).to.equal(TxStatus.FAILED);
        expect(checkOp.lastError).to.include("reverted");

        const checkDoc = await prisma.document.findUniqueOrThrow({
          where: { id: testDocId },
        });
        expect(checkDoc.registrationStatus).to.equal(RegistrationStatus.REGISTRATION_FAILED);
      } finally {
        blockchainService.reconcileTransaction = origReconcile;
      }
    });

    it("should handle RPC outages gracefully without corrupting database state", async () => {
      const txHash = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

      const op = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_rpc_outage`,
          txHash,
          nonce: 13,
          status: TxStatus.SUBMITTED,
        },
      });

      // Stub reconcileTransaction to throw network outage error
      const origReconcile = blockchainService.reconcileTransaction.bind(blockchainService);
      blockchainService.reconcileTransaction = async () => {
        throw new Error("RPC network connection timeout (ETIMEDOUT)");
      };

      try {
        const stats = await reconciliationWorker.runOnce();
        // Zero transactions corrupted
        expect(stats.confirmedCount).to.equal(0);
        expect(stats.revertedCount).to.equal(0);

        // State preserved untouched
        const checkOp = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op.id },
        });
        expect(checkOp.status).to.equal(TxStatus.SUBMITTED);
      } finally {
        blockchainService.reconcileTransaction = origReconcile;
      }
    });

    it("should trigger fee-bump replacement with same nonce when transaction is stale and retryCount < maxRetries", async () => {
      const txHash = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
      const staleDate = new Date(Date.now() - 150000); // 2.5 minutes ago (> 2m threshold)

      const op = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_stale`,
          txHash,
          nonce: 14,
          gasPriceGwei: 20,
          status: TxStatus.SUBMITTED,
          retryCount: 0,
          maxRetries: 3,
          createdAt: staleDate,
        },
      });

      // Stub reconcileTransaction to simulate still pending
      const origReconcile = blockchainService.reconcileTransaction.bind(blockchainService);
      blockchainService.reconcileTransaction = async () => ({
        confirmed: false,
        reverted: false,
      });

      // Stub replaceDocumentRegistration
      const origReplace = blockchainService.replaceDocumentRegistration.bind(blockchainService);
      let capturedNonce: number | null = null;
      blockchainService.replaceDocumentRegistration = async (key, hash, nonce) => {
        capturedNonce = nonce;
        return {
          txHash: "0x" + "f".repeat(64),
          nonce,
          gasPriceGwei: 23, // 15% bump
          status: "SUBMITTED",
          confirmations: 0,
        };
      };

      try {
        const stats = await reconciliationWorker.runOnce();
        expect(stats.replacedCount).to.be.greaterThan(0);

        // Nonce must be identical
        expect(capturedNonce).to.equal(14);

        // Original operation marked REPLACED
        const checkOrigOp = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op.id },
        });
        expect(checkOrigOp.status).to.equal(TxStatus.REPLACED);

        // New replacement operation created with retryCount = 1
        const newOp = await prisma.transactionOperation.findFirst({
          where: {
            documentId: testDocId,
            status: TxStatus.SUBMITTED,
          },
        });
        expect(newOp).to.not.be.null;
        expect(newOp?.retryCount).to.equal(1);
        expect(newOp?.nonce).to.equal(14);
      } finally {
        blockchainService.reconcileTransaction = origReconcile;
        blockchainService.replaceDocumentRegistration = origReplace;
      }
    });

    it("should mark STALLED_NEEDS_RECONCILIATION when retry cap (3) is exceeded", async () => {
      const txHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
      const staleDate = new Date(Date.now() - 150000);

      const op = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_max_retries`,
          txHash,
          nonce: 15,
          status: TxStatus.SUBMITTED,
          retryCount: 3, // Already at max retries
          maxRetries: 3,
          createdAt: staleDate,
        },
      });

      const origReconcile = blockchainService.reconcileTransaction.bind(blockchainService);
      blockchainService.reconcileTransaction = async () => ({
        confirmed: false,
        reverted: false,
      });

      try {
        const stats = await reconciliationWorker.runOnce();
        expect(stats.stalledCount).to.be.greaterThan(0);

        const checkDoc = await prisma.document.findUniqueOrThrow({
          where: { id: testDocId },
        });
        expect(checkDoc.registrationStatus).to.equal(
          RegistrationStatus.STALLED_NEEDS_RECONCILIATION
        );

        const checkOp = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op.id },
        });
        expect(checkOp.lastError).to.include("max retries");
      } finally {
        blockchainService.reconcileTransaction = origReconcile;
      }
    });

    it("should handle original-mines-first replacement race: confirms original and supersedes replacement", async () => {
      const txHash1 = "0x2222222222222222222222222222222222222222222222222222222222222222";
      const txHash2 = "0x3333333333333333333333333333333333333333333333333333333333333333";

      // 1. Original operation (created first, then marked REPLACED when replacement was triggered)
      const op1 = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_race_original`,
          txHash: txHash1,
          nonce: 20,
          status: TxStatus.REPLACED,
          retryCount: 0,
        },
      });

      // 2. Replacement operation (currently SUBMITTED)
      const op2 = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_race_replacement`,
          txHash: txHash2,
          nonce: 20,
          status: TxStatus.SUBMITTED,
          retryCount: 1,
        },
      });

      // Stub reconcileTransaction: txHash1 mined with receipt, txHash2 is null (unmined)
      const origReconcile = blockchainService.reconcileTransaction.bind(blockchainService);
      blockchainService.reconcileTransaction = async (hash) => {
        if (hash === txHash1) {
          return {
            confirmed: true,
            reverted: false,
            blockNumber: 8888n,
            blockTimestamp: new Date(),
          };
        }
        return { confirmed: false, reverted: false };
      };

      try {
        const stats = await reconciliationWorker.runOnce();
        expect(stats.confirmedCount).to.be.greaterThan(0);

        // Verification 1: op1 (the actual mined tx) MUST be marked CONFIRMED
        const checkOp1 = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op1.id },
        });
        expect(checkOp1.status).to.equal(TxStatus.CONFIRMED);

        // Verification 2: op2 (the unmined replacement) MUST be marked REPLACED / superseded
        const checkOp2 = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op2.id },
        });
        expect(checkOp2.status).to.equal(TxStatus.REPLACED);
        expect(checkOp2.lastError).to.include("Superseded");

        // Verification 3: BlockchainRegistration has the CANONICAL mined transaction hash (txHash1)
        const reg = await prisma.blockchainRegistration.findFirst({
          where: { documentId: testDocId },
        });
        expect(reg).to.not.be.null;
        expect(reg?.transactionHash).to.equal(txHash1);
        expect(reg?.blockNumber).to.equal(8888n);
        expect(reg?.status).to.equal(TxStatus.CONFIRMED);

        // Verification 4: Document is CONFIRMED_ON_CHAIN
        const checkDoc = await prisma.document.findUniqueOrThrow({
          where: { id: testDocId },
        });
        expect(checkDoc.registrationStatus).to.equal(RegistrationStatus.CONFIRMED_ON_CHAIN);
      } finally {
        blockchainService.reconcileTransaction = origReconcile;
      }
    });

    it("should handle replacement-mines-first scenario: confirms replacement and leaves original superseded", async () => {
      const txHash1 = "0x4444444444444444444444444444444444444444444444444444444444444444";
      const txHash2 = "0x5555555555555555555555555555555555555555555555555555555555555555";

      const op1 = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_repl_first_1`,
          txHash: txHash1,
          nonce: 21,
          status: TxStatus.REPLACED,
          retryCount: 0,
        },
      });

      const op2 = await prisma.transactionOperation.create({
        data: {
          documentId: testDocId,
          chainId: BigInt(31337),
          idempotencyKey: `op_${testDocId}_repl_first_2`,
          txHash: txHash2,
          nonce: 21,
          status: TxStatus.SUBMITTED,
          retryCount: 1,
        },
      });

      // Stub: txHash2 mined on chain
      const origReconcile = blockchainService.reconcileTransaction.bind(blockchainService);
      blockchainService.reconcileTransaction = async (hash) => {
        if (hash === txHash2) {
          return {
            confirmed: true,
            reverted: false,
            blockNumber: 9999n,
            blockTimestamp: new Date(),
          };
        }
        return { confirmed: false, reverted: false };
      };

      try {
        const stats = await reconciliationWorker.runOnce();
        expect(stats.confirmedCount).to.be.greaterThan(0);

        const checkOp2 = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op2.id },
        });
        expect(checkOp2.status).to.equal(TxStatus.CONFIRMED);

        const checkOp1 = await prisma.transactionOperation.findUniqueOrThrow({
          where: { id: op1.id },
        });
        expect(checkOp1.status).to.equal(TxStatus.REPLACED);

        const reg = await prisma.blockchainRegistration.findFirst({
          where: { documentId: testDocId },
        });
        expect(reg?.transactionHash).to.equal(txHash2);
        expect(reg?.status).to.equal(TxStatus.CONFIRMED);
      } finally {
        blockchainService.reconcileTransaction = origReconcile;
      }
    });

    it("should remain idempotent when reconciliation runs repeatedly after confirmation", async () => {
      // Set document to CONFIRMED_ON_CHAIN
      await prisma.document.update({
        where: { id: testDocId },
        data: { registrationStatus: RegistrationStatus.CONFIRMED_ON_CHAIN },
      });

      // Second run: no operations processed or mutated
      const stats = await reconciliationWorker.runOnce();
      expect(stats.confirmedCount).to.equal(0);
      expect(stats.revertedCount).to.equal(0);
      expect(stats.replacedCount).to.equal(0);
    });
  });

  describe("6.3 On-Chain Registration & Chain Status API", () => {
    let docId: string;

    beforeEach(async () => {
      const doc = await prisma.document.create({
        data: {
          ownerId: userId,
          title: "API Status Doc",
          originalFileName: "api_status.pdf",
          mimeType: "application/pdf",
          fileSize: BigInt(1024),
          storageKey: `doc_api_${Date.now()}.bin`,
          sha256Hash: "2222333344445555666677778888999900001111222233334444555566667777",
          registrationStatus: RegistrationStatus.UPLOADED,
        },
      });
      docId = doc.id;
    });

    it("should query chain status via GET /api/v1/documents/:id/chain-status", async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${docId}/chain-status`)
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.be.true;
      expect(res.body.data.documentId).to.equal(docId);
      expect(res.body.data.registrationStatus).to.equal("UPLOADED");
      expect(res.body.data).to.have.property("documentKey");
      expect(res.body.data).to.have.property("operations");
    });

    it("should reject manual registration if document is already confirmed on-chain", async () => {
      await prisma.document.update({
        where: { id: docId },
        data: { registrationStatus: RegistrationStatus.CONFIRMED_ON_CHAIN },
      });

      const res = await request(app)
        .post(`/api/v1/documents/${docId}/register-on-chain`)
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).to.equal(409);
      expect(res.body.error.code).to.equal("CONFLICT");
    });
  });
});
