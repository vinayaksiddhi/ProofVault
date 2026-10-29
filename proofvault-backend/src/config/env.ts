import dotenv from "dotenv";
import path from "path";

// Load .env from backend folder first, fallback to root .env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenSecret: string;
  refreshTokenExpiresIn: string;
  chainId: number;
  rpcUrl: string;
  localRpcUrl: string;
  confirmationThresholdHardhat: number;
  confirmationThresholdSepolia: number;
  contractAddress: string;
  relayerPrivateKey: string;
  localStoragePath: string;
  maxFileSizeBytes: number;
  frontendUrl: string;
  backendUrl: string;
  reconciliationIntervalMs: number;
  staleTransactionThresholdMs: number;
  maxRetries: number;
  gasBumpPercent: number;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required.");
  }

  const jwtSecret = process.env.JWT_SECRET || "proofvault-default-jwt-secret-for-dev-only-min-32-chars";
  const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "15m";
  const refreshTokenSecret = process.env.REFRESH_TOKEN_SECRET || "proofvault-default-refresh-secret-dev-min-32-chars";
  const refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";

  const chainId = parseInt(process.env.CHAIN_ID || "31337", 10);
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const localRpcUrl = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";

  const confirmationThresholdHardhat = parseInt(process.env.CONFIRMATION_THRESHOLD_HARDHAT || "1", 10);
  const confirmationThresholdSepolia = parseInt(process.env.CONFIRMATION_THRESHOLD_SEPOLIA || "2", 10);

  const contractAddress = process.env.CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000";
  const relayerPrivateKey = process.env.RELAYER_PRIVATE_KEY || "";

  const localStoragePath = path.resolve(
    process.cwd(),
    process.env.LOCAL_STORAGE_PATH || "./temp/storage"
  );
  const maxFileSizeBytes = parseInt(process.env.MAX_FILE_SIZE_BYTES || "26214400", 10); // 25 MB default

  return {
    nodeEnv: process.env.NODE_ENV || "development",
    port: parseInt(process.env.PORT || "4000", 10),
    databaseUrl,
    jwtSecret,
    jwtExpiresIn,
    refreshTokenSecret,
    refreshTokenExpiresIn,
    chainId,
    rpcUrl,
    localRpcUrl,
    confirmationThresholdHardhat,
    confirmationThresholdSepolia,
    contractAddress,
    relayerPrivateKey,
    localStoragePath,
    maxFileSizeBytes,
    frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
    backendUrl: process.env.BACKEND_URL || "http://localhost:4000",
    reconciliationIntervalMs: parseInt(process.env.RECONCILIATION_INTERVAL_MS || "60000", 10),
    staleTransactionThresholdMs: parseInt(process.env.STALE_TRANSACTION_THRESHOLD_MS || "120000", 10),
    maxRetries: parseInt(process.env.MAX_TRANSACTION_RETRIES || "3", 10),
    gasBumpPercent: parseInt(process.env.GAS_BUMP_PERCENT || "15", 10),
  };
}

export const config = loadConfig();
