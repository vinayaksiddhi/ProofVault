import { app } from "./app";
import { config } from "./config";
import { prisma } from "./db/client";
import { reconciliationWorker } from "./workers/reconciliation.worker";

const server = app.listen(config.port, async () => {
  console.log(`[ProofVault-Backend] Running on http://localhost:${config.port}`);
  console.log(`[ProofVault-Backend] Environment: ${config.nodeEnv}`);
  console.log(`[ProofVault-Backend] Chain ID: ${config.chainId}`);

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("[ProofVault-Backend] Database: Connected successfully to PostgreSQL.");
  } catch (err: any) {
    console.error("[ProofVault-Backend] Database connection failure:", err.message);
  }

  // Start background reconciliation worker
  reconciliationWorker.start();
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[ProofVault-Backend] SIGTERM received. Closing HTTP server...");
  reconciliationWorker.stop();
  server.close(async () => {
    await prisma.$disconnect();
    console.log("[ProofVault-Backend] Server and database connection closed.");
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  console.log("[ProofVault-Backend] SIGINT received. Closing HTTP server...");
  reconciliationWorker.stop();
  server.close(async () => {
    await prisma.$disconnect();
    console.log("[ProofVault-Backend] Server and database connection closed.");
    process.exit(0);
  });
});
