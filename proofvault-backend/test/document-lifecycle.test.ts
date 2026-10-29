import request from "supertest";
import { expect } from "chai";
import { app } from "../src/app";
import { clearTestData, SAMPLE_BUFFERS } from "./helpers/test-setup";
import { storageService } from "../src/services/storage.service";
import { prisma } from "../src/db/client";

describe("4. Document Lifecycle: Visibility, Public Verification & Deletion", () => {
  let userToken: string;
  let documentId: string;
  let publicToken: string;

  before(async () => {
    await clearTestData();

    // Register user
    const userRes = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "lifecycle@proofvault.io", password: "Password123!@#" });
    userToken = userRes.body.data.tokens.accessToken;

    // Ingest private document
    const docRes = await request(app)
      .post("/api/v1/documents")
      .set("Authorization", `Bearer ${userToken}`)
      .field("title", "Cert of Title")
      .field("visibility", "PRIVATE")
      .field("registerOnChain", "false")
      .attach("file", SAMPLE_BUFFERS.validPdf, "cert.pdf");

    documentId = docRes.body.data.documentId;
  });

  after(async () => {
    await clearTestData();
  });

  it("4.1 should toggle visibility from PRIVATE to PUBLIC_VERIFIABLE and generate a 256-bit token", async () => {
    const res = await request(app)
      .patch(`/api/v1/documents/${documentId}/visibility`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ visibility: "PUBLIC_VERIFIABLE" });

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data.document.visibility).to.equal("PUBLIC_VERIFIABLE");
    expect(res.body.data.document.publicVerificationToken).to.be.a("string");
    expect(res.body.data.document.publicVerificationToken).to.have.lengthOf(64);

    publicToken = res.body.data.document.publicVerificationToken;
  });

  it("4.2 should allow public access via token and return strictly sanitized DTO (Decision Q8)", async () => {
    const res = await request(app).get(`/api/v1/public/verify/${publicToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data.title).to.equal("Cert of Title");
    expect(res.body.data).to.have.property("canonicalSha256Hash");

    // Zero-leakage policy checks:
    expect(res.body.data).to.not.have.property("ownerId");
    expect(res.body.data).to.not.have.property("ownerEmail");
    expect(res.body.data).to.not.have.property("storageKey");
    expect(res.body.data).to.not.have.property("fileSize");
    expect(res.body.data).to.not.have.property("originalFileName");
  });

  it("4.3 should perform in-memory candidate file check via public verification check endpoint", async () => {
    // Check with matching file
    const resMatch = await request(app)
      .post(`/api/v1/public/verify/${publicToken}/check`)
      .attach("file", SAMPLE_BUFFERS.validPdf, "candidate.pdf");

    expect(resMatch.status).to.equal(200);
    expect(resMatch.body.data.matchFound).to.be.true;

    // Check with mismatched file (valid PNG)
    const resMismatch = await request(app)
      .post(`/api/v1/public/verify/${publicToken}/check`)
      .attach("file", SAMPLE_BUFFERS.validPng, "other.png");

    expect(resMismatch.status).to.equal(200);
    expect(resMismatch.body.data.matchFound).to.be.false;
  });

  it("4.4 should nullify publicVerificationToken when visibility is toggled back to PRIVATE", async () => {
    const res = await request(app)
      .patch(`/api/v1/documents/${documentId}/visibility`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ visibility: "PRIVATE" });

    expect(res.status).to.equal(200);
    expect(res.body.data.document.visibility).to.equal("PRIVATE");
    expect(res.body.data.document.publicVerificationToken).to.be.null;

    // Public endpoint with old token now returns 404 NOT_FOUND
    const pubRes = await request(app).get(`/api/v1/public/verify/${publicToken}`);
    expect(pubRes.status).to.equal(404);
    expect(pubRes.body.error.code).to.equal("NOT_FOUND");
  });

  it("4.5 should delete document: purge file bytes from disk storage and soft-delete database row (Decision Q9)", async () => {
    const docBefore = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });

    // Verify file exists on disk prior to deletion
    const fileExistsBefore = await storageService.fileExists(docBefore.storageKey);
    expect(fileExistsBefore).to.be.true;

    // Delete document
    const delRes = await request(app)
      .delete(`/api/v1/documents/${documentId}`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(delRes.status).to.equal(200);

    // Verify file is purged from private disk
    const fileExistsAfter = await storageService.fileExists(docBefore.storageKey);
    expect(fileExistsAfter).to.be.false;

    // Verify database record is soft-deleted
    const docAfter = await prisma.document.findUniqueOrThrow({
      where: { id: documentId },
    });
    expect(docAfter.isDeleted).to.be.true;
    expect(docAfter.deletedAt).to.not.be.null;

    // Subsequent retrieval returns 404
    const getRes = await request(app)
      .get(`/api/v1/documents/${documentId}`)
      .set("Authorization", `Bearer ${userToken}`);
    expect(getRes.status).to.equal(404);
  });
});
