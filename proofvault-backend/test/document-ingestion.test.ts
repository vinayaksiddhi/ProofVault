import request from "supertest";
import { expect } from "chai";
import crypto from "crypto";
import { app } from "../src/app";
import { clearTestData, SAMPLE_BUFFERS } from "./helpers/test-setup";
import { storageService } from "../src/services/storage.service";

describe("3. Document Ingestion, Hashing & Isolation", () => {
  let userAToken: string;
  let userBToken: string;
  let userADocId: string;

  before(async () => {
    await clearTestData();

    // Create User A
    const resA = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "usera@proofvault.io", password: "Password123!@#" });
    userAToken = resA.body.data.tokens.accessToken;

    // Create User B
    const resB = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "userb@proofvault.io", password: "Password123!@#" });
    userBToken = resB.body.data.tokens.accessToken;
  });

  after(async () => {
    await clearTestData();
  });

  it("3.1 should reject uploads exceeding 25 MiB with 413 PAYLOAD_TOO_LARGE", async () => {
    // 25 MiB + 100 bytes buffer
    const oversizedBuffer = Buffer.alloc(26214400 + 100, 0x25);

    const res = await request(app)
      .post("/api/v1/documents")
      .set("Authorization", `Bearer ${userAToken}`)
      .field("title", "Oversized Document")
      .attach("file", oversizedBuffer, "large.pdf");

    expect(res.status).to.equal(413);
    expect(res.body.success).to.be.false;
    expect(res.body.error.code).to.equal("PAYLOAD_TOO_LARGE");
  });

  it("3.2 should reject files with mismatched magic bytes (text disguised as .pdf) with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set("Authorization", `Bearer ${userAToken}`)
      .field("title", "Disguised Fake PDF")
      .attach("file", SAMPLE_BUFFERS.fakePdf, "fake.pdf");

    expect(res.status).to.equal(415);
    expect(res.body.success).to.be.false;
    expect(res.body.error.code).to.equal("UNSUPPORTED_MEDIA_TYPE");
  });

  it("3.3 should successfully ingest valid PDF, compute exact-byte SHA-256, and store privately", async () => {
    const expectedHash = crypto
      .createHash("sha256")
      .update(SAMPLE_BUFFERS.validPdf)
      .digest("hex")
      .toLowerCase();

    const res = await request(app)
      .post("/api/v1/documents")
      .set("Authorization", `Bearer ${userAToken}`)
      .field("title", "Employment Agreement")
      .field("description", "Legal contract")
      .field("registerOnChain", "false")
      .attach("file", SAMPLE_BUFFERS.validPdf, "agreement.pdf");

    expect(res.status).to.equal(201);
    expect(res.body.success).to.be.true;
    expect(res.body.data.sha256Hash).to.equal(expectedHash);
    expect(res.body.data.title).to.equal("Employment Agreement");
    expect(res.body.data.fileSize).to.equal(SAMPLE_BUFFERS.validPdf.length);
    expect(res.body.data.mimeType).to.equal("application/pdf");

    userADocId = res.body.data.documentId;
  });

  it("3.4 should deduplicate identical file uploaded again by the SAME user (Decision Q1)", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set("Authorization", `Bearer ${userAToken}`)
      .field("title", "Duplicate Upload Attempt")
      .field("registerOnChain", "false")
      .attach("file", SAMPLE_BUFFERS.validPdf, "agreement.pdf");

    // Returns HTTP 200 with existing document payload
    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data.documentId).to.equal(userADocId);
    expect(res.body.data.title).to.equal("Employment Agreement");
  });

  it("3.5 should allow identical file uploaded by a DIFFERENT user with independent record (Decision Q2)", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set("Authorization", `Bearer ${userBToken}`)
      .field("title", "User B Document Copy")
      .field("registerOnChain", "false")
      .attach("file", SAMPLE_BUFFERS.validPdf, "my_agreement.pdf");

    expect(res.status).to.equal(201);
    expect(res.body.success).to.be.true;
    // Must be a distinct document ID
    expect(res.body.data.documentId).to.not.equal(userADocId);
    // Hash is identical
    expect(res.body.data.sha256Hash).to.equal(
      crypto.createHash("sha256").update(SAMPLE_BUFFERS.validPdf).digest("hex")
    );
  });

  it("3.6 should enforce ownership isolation: User B accessing User A's document returns 404 NOT_FOUND", async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${userADocId}`)
      .set("Authorization", `Bearer ${userBToken}`);

    // Uniform 404 response to prevent ID enumeration (SOP-ARCH-003)
    expect(res.status).to.equal(404);
    expect(res.body.success).to.be.false;
    expect(res.body.error.code).to.equal("NOT_FOUND");
  });

  it("3.7 should allow User A to retrieve their own document", async () => {
    const res = await request(app)
      .get(`/api/v1/documents/${userADocId}`)
      .set("Authorization", `Bearer ${userAToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data.document.documentId).to.equal(userADocId);
    // Ensure internal storageKey is NOT leaked in client payload
    expect(res.body.data.document).to.not.have.property("storageKey");
  });
});
