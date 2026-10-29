import { ethers } from "hardhat";

async function main() {
  console.log("==================================================================");
  console.log("PROOFVAULT LOCAL DEPLOYMENT & VERIFICATION SCRIPT");
  console.log("==================================================================");

  const [deployer, relayerAccount] = await ethers.getSigners();
  console.log(`Deployer Address: ${deployer.address}`);
  console.log(`Relayer Address:  ${relayerAccount.address}`);

  // Deploy ProofVault contract
  console.log("\n[1] Deploying ProofVault contract...");
  const ProofVaultFactory = await ethers.getContractFactory("ProofVault");
  const proofVault = await ProofVaultFactory.deploy(deployer.address);
  await proofVault.waitForDeployment();

  const deployedAddress = await proofVault.getAddress();
  console.log(`>>> ProofVault deployed at: ${deployedAddress}`);

  // Verify owner
  const contractOwner = await proofVault.owner();
  console.log(`\n[2] Contract Owner: ${contractOwner}`);
  if (contractOwner !== deployer.address) {
    throw new Error(`Owner mismatch! Expected ${deployer.address}, got ${contractOwner}`);
  }
  console.log(">>> Owner verification: PASSED");

  // Verify initial registrar authorization
  const isDeployerRegistrar = await proofVault.isAuthorizedRegistrar(deployer.address);
  console.log(`Is deployer authorized registrar: ${isDeployerRegistrar}`);

  // Authorize relayer account
  console.log("\n[3] Authorizing Relayer Account as Registrar...");
  const authTx = await proofVault.connect(deployer).setRegistrar(relayerAccount.address, true);
  const authReceipt = await authTx.wait();
  console.log(`Registrar set in tx: ${authReceipt?.hash} (Status: ${authReceipt?.status})`);

  const isRelayerAuthorized = await proofVault.isAuthorizedRegistrar(relayerAccount.address);
  console.log(`Is relayer authorized registrar: ${isRelayerAuthorized}`);
  if (!isRelayerAuthorized) {
    throw new Error("Relayer authorization failed!");
  }
  console.log(">>> Registrar authorization: PASSED");

  // Perform a test document registration
  console.log("\n[4] Performing Test Document Registration via Relayer...");
  const sampleDocKey = ethers.keccak256(ethers.toUtf8Bytes("deployment-test-doc-uuid-001"));
  const sampleDocHash = ethers.keccak256(ethers.toUtf8Bytes("canonical-sha256-test-bytes-proofvault"));

  const regTx = await proofVault.connect(relayerAccount).registerDocument(sampleDocKey, sampleDocHash);
  const regReceipt = await regTx.wait();
  console.log(`Registration tx: ${regReceipt?.hash} (Block: ${regReceipt?.blockNumber}, Gas: ${regReceipt?.gasUsed})`);
  console.log(`>>> Registration receipt status: ${regReceipt?.status}`);

  // Read-back verification via verifyDocument
  console.log("\n[5] Executing Read-Only verifyDocument...");
  const [isMatch, registeredAt, issuer, isRevoked, revokedAt] = await proofVault.verifyDocument(
    sampleDocKey,
    sampleDocHash
  );

  console.log(`- Hash Match:    ${isMatch}`);
  console.log(`- Registered At: ${registeredAt} (${new Date(Number(registeredAt) * 1000).toISOString()})`);
  console.log(`- Issuer:        ${issuer}`);
  console.log(`- Is Revoked:    ${isRevoked}`);
  console.log(`- Revoked At:    ${revokedAt}`);

  if (!isMatch || issuer !== relayerAccount.address || isRevoked) {
    throw new Error("Read-back verification failed!");
  }
  console.log(">>> Read-back verification: PASSED");

  // Read-back verification via getDocument
  console.log("\n[6] Executing Read-Only getDocument...");
  const [docHash, regTimestamp, docIssuer, docRevoked] = await proofVault.getDocument(sampleDocKey);
  console.log(`- Stored Hash:   ${docHash}`);
  console.log(`- Registered At: ${regTimestamp}`);
  console.log(`- Stored Issuer: ${docIssuer}`);
  console.log(`- Total Docs:    ${await proofVault.totalDocumentsRegistered()}`);

  if (docHash !== sampleDocHash) {
    throw new Error("getDocument hash mismatch!");
  }
  console.log(">>> getDocument verification: PASSED");

  console.log("\n==================================================================");
  console.log("ALL LOCAL DEPLOYMENT VERIFICATION CHECKS PASSED SUCCESSFULLY!");
  console.log("==================================================================");
}

main().catch((error) => {
  console.error("Deployment verification failed:", error);
  process.exitCode = 1;
});
