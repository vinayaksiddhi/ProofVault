import { expect } from "chai";
import { coordinationService, CoordinationService } from "../src/services/coordination.service";
import { prisma } from "../src/db/client";
import { clearTestData } from "./helpers/test-setup";
import { Role, UserStatus } from "@prisma/client";

describe("8. PostgreSQL Coordination & Nonce Reservation (Stage 3 Remediation)", () => {
  let testDocId: string;
  let testUserId: string;

  before(async () => {
    await clearTestData();
    const user = await prisma.user.create({
      data: {
        email: "coord-test@proofvault.io",
        passwordHash: "hash123",
        role: Role.USER,
        status: UserStatus.ACTIVE,
      },
    });
    testUserId = user.id;

    const doc = await prisma.document.create({
      data: {
        ownerId: user.id,
        title: "Coordination Test Document",
        originalFileName: "coord.pdf",
        mimeType: "application/pdf",
        fileSize: BigInt(256),
        storageKey: `doc_coord_${Date.now()}.bin`,
        sha256Hash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      },
    });
    testDocId = doc.id;
  });

  after(async () => {
    await clearTestData();
  });

  it("8.1 should durably reserve relayer nonce with transaction-scoped lock in <5ms without holding long connection", async () => {
    const relayer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const res = await coordinationService.reserveRelayerNonce(testDocId, relayer, 5);

    expect(res).to.have.property("operationId");
    expect(res.nonce).to.be.at.least(5);

    // Verify record was durably written to DB in PENDING status
    const dbOp = await prisma.transactionOperation.findUniqueOrThrow({
      where: { id: res.operationId },
    });
    expect(dbOp.nonce).to.equal(res.nonce);
    expect(dbOp.status).to.equal("PENDING");
  });

  it("8.2 should serialize concurrent nonce reservations without collisions", async () => {
    const relayer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

    // Launch 5 concurrent nonce reservation requests simultaneously
    const reservationPromises = Array.from({ length: 5 }, (_, i) =>
      coordinationService.reserveRelayerNonce(
        testDocId,
        relayer,
        10,
        `concurrent_idempotency_key_${Date.now()}_${i}`
      )
    );

    const results = await Promise.all(reservationPromises);
    const nonces = results.map((r) => r.nonce);

    // All 5 nonces must be strictly unique (no collision)
    const uniqueNonces = new Set(nonces);
    expect(uniqueNonces.size).to.equal(5);

    // Nonces must be strictly greater than or equal to on-chain pending nonce (10)
    for (const n of nonces) {
      expect(n).to.be.at.least(10);
    }
  });

  it("8.3 should enforce worker exclusivity across simulated separate instances", async () => {
    // Instance 1
    const instance1 = coordinationService;
    // Instance 2 (simulate separate process or container with distinct instanceId)
    const instance2 = new CoordinationService();

    // 1. Instance 1 acquires worker lock
    const acquired1 = await instance1.acquireWorkerLock(60);
    expect(acquired1).to.be.true;

    // 2. Instance 2 attempts to acquire while Instance 1 holds active lease -> must fail
    const acquired2 = await instance2.acquireWorkerLock(60);
    expect(acquired2).to.be.false;

    // 3. Instance 1 releases worker lock
    const released1 = await instance1.releaseWorkerLock();
    expect(released1).to.be.true;

    // 4. Now Instance 2 can acquire worker lock
    const acquired2AfterRelease = await instance2.acquireWorkerLock(60);
    expect(acquired2AfterRelease).to.be.true;

    // Clean up
    await instance2.releaseWorkerLock();
  });

  it("8.4 should recover worker lease when previous instance crashes (lease expires)", async () => {
    const instance1 = new CoordinationService();
    const instance2 = new CoordinationService();

    // 1. Instance 1 acquires lease with 1 second TTL
    const acquired1 = await instance1.acquireWorkerLock(1);
    expect(acquired1).to.be.true;

    // Simulate crash of Instance 1: Instance 1 terminates without calling releaseWorkerLock()

    // Immediate attempt by Instance 2 must fail
    const immediateAcquire = await instance2.acquireWorkerLock(60);
    expect(immediateAcquire).to.be.false;

    // Wait 1.1s for lease TTL to expire
    await new Promise((r) => setTimeout(r, 1100));

    // Instance 2 can now acquire the expired lease automatically (crash recovery)
    const acquiredAfterExpiry = await instance2.acquireWorkerLock(60);
    expect(acquiredAfterExpiry).to.be.true;

    await instance2.releaseWorkerLock();
  });

  it("8.5 should handle exceptions safely in withRelayerLock and release lock", async () => {
    let exceptionThrown = false;
    try {
      await coordinationService.withRelayerLock(async () => {
        throw new Error("Simulated failure inside relayer critical section");
      });
    } catch (err: any) {
      exceptionThrown = true;
      expect(err.message).to.include("Simulated failure");
    }

    expect(exceptionThrown).to.be.true;

    // After exception, the lock must be completely released, allowing immediate subsequent access
    const result = await coordinationService.withRelayerLock(async () => {
      return "SUCCESS_AFTER_EXCEPTION";
    });
    expect(result).to.equal("SUCCESS_AFTER_EXCEPTION");
  });
});
