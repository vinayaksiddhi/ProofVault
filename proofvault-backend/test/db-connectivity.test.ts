import { expect } from "chai";
import { prisma } from "../src/db/client";
import { clearTestData } from "./helpers/test-setup";
import { Role, UserStatus, TxStatus } from "@prisma/client";

describe("1. Database Connectivity & Prisma Operations", () => {
  before(async () => {
    await clearTestData();
  });

  after(async () => {
    await clearTestData();
  });

  it("1.1 should successfully connect to the existing PostgreSQL container", async () => {
    const result: any = await prisma.$queryRaw`SELECT 1 as connected;`;
    expect(result).to.be.an("array");
    expect(result[0].connected).to.equal(1);
  });

  it("1.2 should support User model operations with UUID keys", async () => {
    const user = await prisma.user.create({
      data: {
        email: "dbtest@proofvault.io",
        passwordHash: "$2a$12$eXampleHashedPasswordForTestPurposesOnly",
        role: Role.USER,
        status: UserStatus.ACTIVE,
      },
    });

    expect(user.id).to.be.a("string");
    expect(user.email).to.equal("dbtest@proofvault.io");

    const fetched = await prisma.user.findUnique({
      where: { id: user.id },
    });
    expect(fetched).to.not.be.null;
    expect(fetched?.email).to.equal("dbtest@proofvault.io");
  });

  it("1.3 should verify BlockchainRegistration schema contains mandated revocation fields", async () => {
    const user = await prisma.user.findFirstOrThrow({
      where: { email: "dbtest@proofvault.io" },
    });

    const doc = await prisma.document.create({
      data: {
        ownerId: user.id,
        title: "Test Revocation Doc",
        originalFileName: "test.pdf",
        mimeType: "application/pdf",
        fileSize: BigInt(1024),
        storageKey: "test_key_001.bin",
        sha256Hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    });

    const reg = await prisma.blockchainRegistration.create({
      data: {
        documentId: doc.id,
        chainId: BigInt(31337),
        contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        documentKey: "0x1111111111111111111111111111111111111111111111111111111111111111",
        documentHash: "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        issuerAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        transactionHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
        status: TxStatus.CONFIRMED,
        isRevoked: false,
        revokedAt: null,
        revocationReason: null,
      },
    });

    expect(reg.isRevoked).to.equal(false);
    expect(reg.revokedAt).to.be.null;
    expect(reg.revocationReason).to.be.null;

    // Test updating revocation fields
    const now = new Date();
    const updatedReg = await prisma.blockchainRegistration.update({
      where: { id: reg.id },
      data: {
        isRevoked: true,
        revokedAt: now,
        revocationReason: "Key compromise test reason",
      },
    });

    expect(updatedReg.isRevoked).to.equal(true);
    expect(updatedReg.revokedAt).to.not.be.null;
    expect(updatedReg.revocationReason).to.equal("Key compromise test reason");
  });

  it("1.4 should guarantee read-only operations never mutate the database", async () => {
    // Count records before read queries
    const userCountBefore = await prisma.user.count();
    const docCountBefore = await prisma.document.count();
    const regCountBefore = await prisma.blockchainRegistration.count();

    // Execute multiple read queries
    await prisma.user.findMany();
    await prisma.document.findMany();
    await prisma.blockchainRegistration.findMany();
    await prisma.auditLog.findMany();

    // Verify counts are strictly identical
    const userCountAfter = await prisma.user.count();
    const docCountAfter = await prisma.document.count();
    const regCountAfter = await prisma.blockchainRegistration.count();

    expect(userCountAfter).to.equal(userCountBefore);
    expect(docCountAfter).to.equal(docCountBefore);
    expect(regCountAfter).to.equal(regCountBefore);
  });
});
