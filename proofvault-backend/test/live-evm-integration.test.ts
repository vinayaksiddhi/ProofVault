import { expect } from "chai";
import request from "supertest";
import { app } from "../src/app";
import { ethers, Contract, JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { blockchainService } from "../src/services/blockchain.service";
import { reconciliationWorker } from "../src/workers/reconciliation.worker";
import { prisma } from "../src/db/client";
import { clearTestData, SAMPLE_BUFFERS } from "./helpers/test-setup";
import { deriveDocumentKey, formatBytes32, computeSha256 } from "../src/utils/crypto.utils";
import { RegistrationStatus, TxStatus } from "@prisma/client";

// Import contract artifact with ABI and bytecode
const proofVaultArtifactPath = path.resolve(
  __dirname,
  "../../proofvault-blockchain/artifacts/contracts/ProofVault.sol/ProofVault.json"
);
const proofVaultArtifact = JSON.parse(fs.readFileSync(proofVaultArtifactPath, "utf8"));

describe("9. Live Local Hardhat EVM Integration Verification (Stage 3 Remediation)", function () {
  this.timeout(90000); // 90 seconds for node spin-up, contract deployment, and mining

  let hardhatNodeProcess: ChildProcess | null = null;
  let provider: JsonRpcProvider;
  let deployerWallet: Wallet;
  let relayerWallet: Wallet;
  let proofVaultContract: Contract;
  let userToken: string;
  let userId: string;

  // Dedicated Hardhat local test accounts (Accounts #0 and #1 with prefunded test ETH)
  const LOCAL_RPC_URL = "http://127.0.0.1:8545";
  const DEPLOYER_PRIVATE_KEY =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const RELAYER_PRIVATE_KEY =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  // Check if port 8545 is reachable
  async function isNodeReachable(): Promise<boolean> {
    try {
      const p = new JsonRpcProvider(LOCAL_RPC_URL);
      const network = await p.getNetwork();
      return network.chainId === 31337n;
    } catch {
      return false;
    }
  }

  before(async function () {
    await clearTestData();

    // 1. Authenticate test user
    const regRes = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "live-evm@proofvault.io", password: "Password123!@#" });
    userToken = regRes.body.data.tokens.accessToken;
    userId = regRes.body.data.user.id;

    // 2. Ensure Hardhat node is running on 127.0.0.1:8545
    let reachable = await isNodeReachable();
    if (!reachable) {
      console.log("[LiveEVMTest] Starting local Hardhat node...");
      const blockchainDir = path.resolve(__dirname, "../../proofvault-blockchain");
      const isWindows = process.platform === "win32";

      hardhatNodeProcess = spawn(
        isWindows ? "cmd.exe" : "npx",
        isWindows ? ["/c", "npx", "hardhat", "node"] : ["hardhat", "node"],
        {
          cwd: blockchainDir,
          stdio: "ignore",
          detached: false,
          shell: isWindows,
        }
      );

      // Poll until node is ready
      let attempts = 0;
      while (!reachable && attempts < 30) {
        await new Promise((r) => setTimeout(r, 1000));
        reachable = await isNodeReachable();
        attempts++;
      }

      if (!reachable) {
        throw new Error("Failed to start local Hardhat node on port 8545 within 30 seconds.");
      }
      console.log("[LiveEVMTest] Local Hardhat node started successfully.");
    }

    // 3. Connect ethers provider and wallets
    provider = new JsonRpcProvider(LOCAL_RPC_URL);
    deployerWallet = new Wallet(DEPLOYER_PRIVATE_KEY, provider);
    relayerWallet = new Wallet(RELAYER_PRIVATE_KEY, provider);

    // 4. Deploy ProofVault contract to local Hardhat node
    console.log("[LiveEVMTest] Deploying ProofVault contract locally...");
    const factory = new ContractFactory(
      proofVaultArtifact.abi,
      proofVaultArtifact.bytecode,
      deployerWallet
    );
    proofVaultContract = (await factory.deploy(deployerWallet.address)) as Contract;
    await proofVaultContract.waitForDeployment();
    const contractAddress = await proofVaultContract.getAddress();
    console.log(`[LiveEVMTest] ProofVault deployed at: ${contractAddress}`);

    // 5. Authorize Relayer account as registrar on-chain
    const authTx = await proofVaultContract.setRegistrar(relayerWallet.address, true);
    await authTx.wait(1);
    const isRelayerAuthorized = await proofVaultContract.isAuthorizedRegistrar(
      relayerWallet.address
    );
    expect(isRelayerAuthorized).to.be.true;

    // 6. Configure blockchainService with the live contract and relayer
    blockchainService.setProvider(provider);
    blockchainService.setContract(proofVaultContract.connect(relayerWallet) as Contract);
    blockchainService.setWallet(relayerWallet);
  });

  after(async function () {
    // Stop spawned Hardhat node if we started it
    if (hardhatNodeProcess && hardhatNodeProcess.pid) {
      console.log("[LiveEVMTest] Terminating spawned Hardhat node...");
      if (process.platform === "win32") {
        try {
          const { execSync } = require("child_process");
          execSync(`taskkill /pid ${hardhatNodeProcess.pid} /T /F`, { stdio: "ignore" });
        } catch {
          hardhatNodeProcess.kill("SIGINT");
        }
      } else {
        hardhatNodeProcess.kill("SIGINT");
      }
      hardhatNodeProcess = null;
    }
    await clearTestData();
  });

  it("9.1 should verify local node network is active and chainId is exactly 31337", async () => {
    const network = await provider.getNetwork();
    expect(network.chainId).to.equal(31337n);
    expect(blockchainService.getChainId()).to.equal(31337);
  });

  it("9.2 should verify ProofVault on-chain initialization and registrar authorization", async () => {
    const owner = await proofVaultContract.owner();
    expect(owner.toLowerCase()).to.equal(deployerWallet.address.toLowerCase());

    const isAuthorized = await proofVaultContract.isAuthorizedRegistrar(relayerWallet.address);
    expect(isAuthorized).to.be.true;
  });

  it("9.3 should execute full live flow: upload -> SHA-256 -> DB -> transaction broadcast -> mined receipt -> worker reconciliation -> on-chain verify", async () => {
    // 1. Upload document through backend API
    const uploadRes = await request(app)
      .post("/api/v1/documents/upload")
      .set("Authorization", `Bearer ${userToken}`)
      .attach("file", SAMPLE_BUFFERS.validPdf, "live_integration_doc.pdf")
      .field("title", "Live EVM Verified Document")
      .field("registerOnChain", "true");

    expect(uploadRes.status).to.equal(201);
    expect(uploadRes.body.success).to.be.true;

    const docId = uploadRes.body.data.documentId;
    const computedHash = uploadRes.body.data.sha256Hash;
    const expectedKey = deriveDocumentKey(docId);
    const expectedHashBytes32 = formatBytes32(computedHash);

    // Document was submitted to chain
    expect(uploadRes.body.data.registrationStatus).to.be.oneOf([
      "SUBMITTED_TO_CHAIN",
      "CONFIRMED_ON_CHAIN",
    ]);

    // 2. Run reconciliation worker to reconcile actual mined receipt
    const stats = await reconciliationWorker.runOnce();
    console.log("[LiveEVMTest] Worker reconciliation stats:", stats);

    // 3. Verify Database state: Document must be CONFIRMED_ON_CHAIN
    const docInDb = await prisma.document.findUniqueOrThrow({
      where: { id: docId },
      include: {
        registrations: true,
        txOperations: true,
      },
    });

    expect(docInDb.registrationStatus).to.equal(RegistrationStatus.CONFIRMED_ON_CHAIN);
    expect(docInDb.registrations.length).to.be.at.least(1);
    const reg = docInDb.registrations[0];
    expect(reg.status).to.equal(TxStatus.CONFIRMED);
    expect(reg.blockNumber).to.not.be.null;
    expect(reg.transactionHash).to.match(/^0x[a-f0-9]{64}$/i);

    // 4. Read-back verification directly from local Hardhat smart contract
    const onChainResult = await blockchainService.verifyDocument(expectedKey, expectedHashBytes32);
    expect(onChainResult.matchFound).to.be.true;
    expect(onChainResult.isRevoked).to.be.false;
    expect(onChainResult.issuer?.toLowerCase()).to.equal(relayerWallet.address.toLowerCase());
    expect(onChainResult.registeredAt).to.be.greaterThan(0);

    // 5. Query status API: GET /api/v1/documents/:id/chain-status
    const statusRes = await request(app)
      .get(`/api/v1/documents/${docId}/chain-status`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(statusRes.status).to.equal(200);
    expect(statusRes.body.data.registrationStatus).to.equal("CONFIRMED_ON_CHAIN");
    expect(statusRes.body.data.onChainConfirmed).to.be.true;
  });

  it("9.4 should execute on-chain revocation and verify read-back state", async () => {
    // 1. Upload another document for revocation testing
    const uploadRes = await request(app)
      .post("/api/v1/documents/upload")
      .set("Authorization", `Bearer ${userToken}`)
      .attach("file", SAMPLE_BUFFERS.validPdf, "revoke_integration_doc.pdf")
      .field("title", "Document to Revoke")
      .field("registerOnChain", "true");

    const docId = uploadRes.body.data.documentId;
    const docKey = deriveDocumentKey(docId);
    const docHashBytes32 = formatBytes32(uploadRes.body.data.sha256Hash);

    // Ensure confirmed on-chain
    await reconciliationWorker.runOnce();

    // 2. Call backend revocation endpoint
    const revokeReason = "Formal breach of agreement terms - revoked on-chain";
    const revokeRes = await request(app)
      .post(`/api/v1/documents/${docId}/revoke`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({ reason: revokeReason });

    expect(revokeRes.status).to.equal(200);
    expect(revokeRes.body.data.blockchainRegistration.isRevoked).to.be.true;
    expect(revokeRes.body.data.blockchainRegistration.revocationReason).to.equal(revokeReason);

    // 3. Query on-chain smart contract directly: verify matchFound is false and isRevoked is true
    const onChainVerify = await blockchainService.verifyDocument(docKey, docHashBytes32);
    expect(onChainVerify.matchFound).to.be.false; // Match is false after revocation
    expect(onChainVerify.isRevoked).to.be.true;
  });

  it("9.5 should confirm malformed receipts cannot falsely mark registrations confirmed", async () => {
    // Create an unmined transaction operation in DB
    const dummyKey = deriveDocumentKey("malformed-test-doc");
    const dummyHash = formatBytes32(computeSha256(Buffer.from("dummy-content-12345")));

    const doc = await prisma.document.create({
      data: {
        ownerId: userId,
        title: "Malformed Receipt Test Doc",
        originalFileName: "malformed.pdf",
        mimeType: "application/pdf",
        fileSize: BigInt(128),
        storageKey: `doc_malformed_${Date.now()}.bin`,
        sha256Hash: "9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff",
        registrationStatus: RegistrationStatus.SUBMITTED_TO_CHAIN,
      },
    });

    const dummyTxHash = "0x" + "9".repeat(64);
    await prisma.transactionOperation.create({
      data: {
        documentId: doc.id,
        chainId: BigInt(31337),
        idempotencyKey: `op_${doc.id}_malformed`,
        txHash: dummyTxHash,
        nonce: 999,
        status: TxStatus.SUBMITTED,
      },
    });

    // Reconcile against non-existent / empty receipt on chain
    const reconcileResult = await blockchainService.reconcileTransaction(
      dummyTxHash,
      dummyKey,
      dummyHash
    );

    // Must NOT be confirmed!
    expect(reconcileResult.confirmed).to.be.false;

    // Document in DB must NOT be confirmed
    const checkDoc = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
    });
    expect(checkDoc.registrationStatus).to.equal(RegistrationStatus.SUBMITTED_TO_CHAIN);
  });
});
