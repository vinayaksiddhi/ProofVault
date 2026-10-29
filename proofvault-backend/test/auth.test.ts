import request from "supertest";
import { expect } from "chai";
import { app } from "../src/app";
import { clearTestData } from "./helpers/test-setup";

describe("2. Authentication & Authorization", () => {
  before(async () => {
    await clearTestData();
  });

  after(async () => {
    await clearTestData();
  });

  const validUser = {
    email: "alice@proofvault.io",
    password: "Password123!@#",
  };

  let aliceToken: string;

  it("2.1 should register a new user with complex password and return JWT tokens", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(validUser);

    expect(res.status).to.equal(201);
    expect(res.body.success).to.be.true;
    expect(res.body.data.user.email).to.equal(validUser.email);
    expect(res.body.data.tokens).to.have.property("accessToken");
    expect(res.body.data.tokens).to.have.property("refreshToken");
    // Verify secret redaction: passwordHash must NOT be in response
    expect(res.body.data.user).to.not.have.property("passwordHash");
    expect(res.body.data.user).to.not.have.property("password");
  });

  it("2.2 should reject registration with weak passwords", async () => {
    // Missing uppercase and special char
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "weak@proofvault.io", password: "short" });

    expect(res.status).to.equal(400);
    expect(res.body.success).to.be.false;
    expect(res.body.error.code).to.equal("BAD_REQUEST");
  });

  it("2.3 should reject registration for existing email with 409 CONFLICT", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(validUser);

    expect(res.status).to.equal(409);
    expect(res.body.success).to.be.false;
    expect(res.body.error.code).to.equal("CONFLICT");
  });

  it("2.4 should successfully log in with valid credentials and return JWT", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send(validUser);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data.tokens).to.have.property("accessToken");
    aliceToken = res.body.data.tokens.accessToken;
  });

  it("2.5 should reject login with invalid password with 401 UNAUTHORIZED", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: validUser.email, password: "WrongPassword999!" });

    expect(res.status).to.equal(401);
    expect(res.body.success).to.be.false;
    expect(res.body.error.code).to.equal("UNAUTHORIZED");
  });

  it("2.6 should access protected /api/v1/auth/me with valid Bearer token", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${aliceToken}`);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data.user.email).to.equal(validUser.email);
    expect(res.body.data.user).to.not.have.property("passwordHash");
  });

  it("2.7 should reject protected endpoint access without token or with malformed token", async () => {
    const resNoToken = await request(app).get("/api/v1/auth/me");
    expect(resNoToken.status).to.equal(401);
    expect(resNoToken.body.error.code).to.equal("UNAUTHORIZED");

    const resBadToken = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer invalid.jwt.token");
    expect(resBadToken.status).to.equal(401);
    expect(resBadToken.body.error.code).to.equal("UNAUTHORIZED");
  });
});
