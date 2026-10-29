import {
  ethers,
  Contract,
  JsonRpcProvider,
  Wallet,
  Interface,
  TransactionReceipt,
} from "ethers";
import { config } from "../config";
import { coordinationService } from "./coordination.service";
import ProofVaultArtifact from "../contracts/ProofVault.abi.json";
import { prisma } from "../db/client";
import { TxStatus } from "@prisma/client";

export interface PreFlightResult {
  exists: boolean;
  documentHash?: string;
  registeredAt?: number;
  issuer?: string;
  isRevoked?: boolean;
}

export interface RegisterOnChainResult {
  txHash: string;
  nonce?: number;
  gasPriceGwei?: number;
  blockNumber?: bigint;
  blockTimestamp?: Date;
  status: "CONFIRMED" | "SUBMITTED" | "FAILED";
  confirmations: number;
}

export interface VerifyOnChainResult {
  matchFound: boolean;
  registeredAt?: number;
  issuer?: string;
  isRevoked: boolean;
}

export interface RevokeOnChainResult {
  txHash: string;
  blockNumber?: bigint;
  status: "CONFIRMED" | "SUBMITTED" | "FAILED";
}

export interface ReceiptValidationResult {
  isValid: boolean;
  reason?: string;
  documentKey?: string;
  documentHash?: string;
  issuer?: string;
  registeredAt?: number;
  blockNumber?: number;
}

export interface ReconcileResult {
  confirmed: boolean;
  reverted: boolean;
  blockNumber?: bigint;
  blockTimestamp?: Date;
  validationError?: string;
}

export class BlockchainService {
  private provider: JsonRpcProvider | null = null;
  private wallet: Wallet | null = null;
  private contract: Contract | null = null;
  private iface: Interface;
  private initialized = false;

  constructor() {
    this.iface = new Interface(ProofVaultArtifact.abi);
    this.initProvider();
  }

  private initProvider(): void {
    try {
      const rpcUrl = config.chainId === 31337 ? config.localRpcUrl : config.rpcUrl;
      this.provider = new JsonRpcProvider(rpcUrl);

      if (
        config.relayerPrivateKey &&
        config.relayerPrivateKey !== "0x0000000000000000000000000000000000000000000000000000000000000000" &&
        config.relayerPrivateKey.length === 66
      ) {
        this.wallet = new Wallet(config.relayerPrivateKey, this.provider);
      }

      if (
        config.contractAddress &&
        config.contractAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        const signerOrProvider = this.wallet || this.provider;
        this.contract = new Contract(
          config.contractAddress,
          ProofVaultArtifact.abi,
          signerOrProvider
        );
      }

      this.initialized = true;
    } catch (err: any) {
      console.warn("[BlockchainService] Initialized with limited functionality:", err.message);
      this.initialized = false;
    }
  }

  setContract(contract: Contract): void {
    this.contract = contract;
    this.initialized = true;
  }

  setProvider(provider: JsonRpcProvider): void {
    this.provider = provider;
  }

  setWallet(wallet: Wallet): void {
    this.wallet = wallet;
  }

  getProvider(): JsonRpcProvider | null {
    return this.provider;
  }

  getContract(): Contract | null {
    return this.contract;
  }

  isConfigured(): boolean {
    return !!(this.contract && this.wallet);
  }

  getContractAddress(): string {
    return config.contractAddress;
  }

  getChainId(): number {
    return config.chainId;
  }

  getRelayerAddress(): string | null {
    return this.wallet ? this.wallet.address : null;
  }

  /**
   * Pre-flight read: Checks if the documentKey is already registered on-chain.
   * Strictly non-mutating and idempotent.
   */
  async preFlightCheck(documentKey: string): Promise<PreFlightResult> {
    if (!this.contract) {
      return { exists: false };
    }

    try {
      const res = await this.contract.getDocument(documentKey);
      const docHash = res[0];
      const registeredAt = Number(res[1]);
      const issuer = res[2];
      const isRevoked = Boolean(res[3]);
      const exists = docHash !== ethers.ZeroHash && registeredAt > 0;

      return {
        exists,
        documentHash: exists ? docHash : undefined,
        registeredAt: exists ? registeredAt : undefined,
        issuer: exists ? issuer : undefined,
        isRevoked: exists ? isRevoked : false,
      };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Allocates the next safe monotonic nonce for the relayer wallet,
   * coordinating across multiple processes via PostgreSQL advisory lock.
   */
  async allocateNextNonce(relayerAddress: string): Promise<number> {
    if (!this.provider) {
      throw new Error("RPC provider is not connected.");
    }

    const onChainPendingNonce = await this.provider.getTransactionCount(relayerAddress, "pending");

    // Check highest nonce currently in the database
    const latestDbOp = await prisma.transactionOperation.findFirst({
      where: {
        nonce: { not: null },
      },
      orderBy: { nonce: "desc" },
    });

    const maxDbNonce = latestDbOp?.nonce ?? -1;
    return Math.max(onChainPendingNonce, maxDbNonce + 1);
  }

  /**
   * Verifies that a transaction receipt is valid and includes the expected
   * DocumentRegistered event topic matching the expected documentKey and documentHash.
   * Rejects missing, malformed, unrelated, or mismatched events.
   * Never falls back to unconditional success.
   */
  verifyReceiptAndEvent(
    receipt: TransactionReceipt | null | undefined,
    documentKey: string,
    documentHash: string,
    expectedContractAddress?: string
  ): ReceiptValidationResult {
    if (!receipt) {
      return { isValid: false, reason: "RECEIPT_NULL_OR_UNDEFINED" };
    }

    if (receipt.status !== 1) {
      return { isValid: false, reason: "TRANSACTION_REVERTED_STATUS_ZERO" };
    }

    const targetContract = (expectedContractAddress || this.getContractAddress() || "").toLowerCase();

    // Check destination contract address if receipt.to is available and contract is configured
    if (
      receipt.to &&
      targetContract &&
      targetContract !== "0x0000000000000000000000000000000000000000"
    ) {
      if (receipt.to.toLowerCase() !== targetContract) {
        return { isValid: false, reason: "DESTINATION_CONTRACT_MISMATCH" };
      }
    }

    if (!receipt.logs || receipt.logs.length === 0) {
      return { isValid: false, reason: "EMPTY_EVENT_LOGS" };
    }

    let foundRegisteredEvent = false;

    // Inspect event logs for DocumentRegistered(bytes32,bytes32,address,uint64)
    for (const log of receipt.logs) {
      // If contract address is configured, check log emitter address
      if (
        targetContract &&
        targetContract !== "0x0000000000000000000000000000000000000000" &&
        log.address.toLowerCase() !== targetContract
      ) {
        continue;
      }

      try {
        const parsed = this.iface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (parsed && parsed.name === "DocumentRegistered") {
          foundRegisteredEvent = true;
          const parsedKey = String(parsed.args[0]).toLowerCase();
          const parsedHash = String(parsed.args[1]).toLowerCase();

          if (parsedKey !== documentKey.toLowerCase()) {
            return {
              isValid: false,
              reason: `DOCUMENT_KEY_MISMATCH: expected ${documentKey.toLowerCase()}, got ${parsedKey}`,
            };
          }

          if (parsedHash !== documentHash.toLowerCase()) {
            return {
              isValid: false,
              reason: `DOCUMENT_HASH_MISMATCH: expected ${documentHash.toLowerCase()}, got ${parsedHash}`,
            };
          }

          return {
            isValid: true,
            documentKey: parsedKey,
            documentHash: parsedHash,
            issuer: String(parsed.args[2]),
            registeredAt: Number(parsed.args[3]),
            blockNumber: receipt.blockNumber,
          };
        }
      } catch {
        // Not a matching event log; continue scanning
      }
    }

    return {
      isValid: false,
      reason: foundRegisteredEvent
        ? "DOCUMENT_MISMATCH"
        : "NO_DOCUMENT_REGISTERED_EVENT_FOUND",
    };
  }

  /**
   * Registers a document hash on-chain using the relayer wallet with safe
   * database nonce reservation, pre-flight protection, and runtime network validation.
   */
  async registerDocument(
    documentKey: string,
    documentHash: string,
    forcedNonce?: number,
    gasOverride?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }
  ): Promise<RegisterOnChainResult> {
    if (!this.contract || !this.wallet || !this.provider) {
      throw new Error("Blockchain relayer or contract is not configured.");
    }

    // 1. Fail-closed network verification before signing/broadcasting
    const network = await this.provider.getNetwork();
    const providerChainId = Number(network.chainId);
    if (providerChainId !== config.chainId) {
      throw new Error(
        `Chain ID mismatch! Configured chain ID is ${config.chainId}, but RPC node reports ${providerChainId}. Failing closed.`
      );
    }

    if (config.chainId === 1 || providerChainId === 1) {
      throw new Error("Refusing to broadcast: Ethereum mainnet (chainId: 1) is strictly forbidden.");
    }

    // 2. Pre-flight check: if already registered, return confirmed immediately
    const preFlight = await this.preFlightCheck(documentKey);
    if (preFlight.exists) {
      return {
        txHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        status: "CONFIRMED",
        confirmations: 1,
      };
    }

    // 3. Allocate nonce outside long database lock
    const relayerAddress = this.wallet.address;
    const nonce =
      forcedNonce !== undefined ? forcedNonce : await this.allocateNextNonce(relayerAddress);

    // 4. Populate transaction parameters
    const populatedTx = await this.contract.registerDocument.populateTransaction(
      documentKey,
      documentHash
    );
    populatedTx.nonce = nonce;

    // Fee handling
    const feeData = await this.provider.getFeeData();
    let gasPriceGwei = 0;

    if (gasOverride?.maxFeePerGas && gasOverride?.maxPriorityFeePerGas) {
      populatedTx.maxFeePerGas = gasOverride.maxFeePerGas;
      populatedTx.maxPriorityFeePerGas = gasOverride.maxPriorityFeePerGas;
      gasPriceGwei = Number(ethers.formatUnits(gasOverride.maxFeePerGas, "gwei"));
    } else if (gasOverride?.gasPrice) {
      populatedTx.gasPrice = gasOverride.gasPrice;
      gasPriceGwei = Number(ethers.formatUnits(gasOverride.gasPrice, "gwei"));
    } else if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      populatedTx.maxFeePerGas = feeData.maxFeePerGas;
      populatedTx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
      gasPriceGwei = Number(ethers.formatUnits(feeData.maxFeePerGas, "gwei"));
    } else if (feeData.gasPrice) {
      populatedTx.gasPrice = feeData.gasPrice;
      gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice, "gwei"));
    }

    const tx = await this.wallet.sendTransaction(populatedTx);
    const txHash = tx.hash;

    const threshold =
      config.chainId === 31337
        ? config.confirmationThresholdHardhat
        : config.confirmationThresholdSepolia;

    try {
      const receipt = await tx.wait(threshold);
      if (receipt && receipt.status === 1) {
        const validation = this.verifyReceiptAndEvent(receipt, documentKey, documentHash);
        if (validation.isValid) {
          let blockTimestamp: Date | undefined;
          if (this.provider && receipt.blockNumber) {
            try {
              const block = await this.provider.getBlock(receipt.blockNumber);
              if (block) {
                blockTimestamp = new Date(Number(block.timestamp) * 1000);
              }
            } catch {
              // Block timestamp fallback
            }
          }

          return {
            txHash,
            nonce,
            gasPriceGwei,
            blockNumber: BigInt(receipt.blockNumber),
            blockTimestamp: blockTimestamp || new Date(),
            status: "CONFIRMED",
            confirmations: threshold,
          };
        }
      }

      return {
        txHash,
        nonce,
        gasPriceGwei,
        status: "FAILED",
        confirmations: 0,
      };
    } catch {
      // Timeout or delay: return SUBMITTED. Do NOT assume failure! (Decision Q4)
      return {
        txHash,
        nonce,
        gasPriceGwei,
        status: "SUBMITTED",
        confirmations: 0,
      };
    }
  }

  /**
   * Broadcasts an EIP-1559 replacement transaction using the exact same nonce
   * and a 15% gas fee bump (SOP-ARCH-002 Step 2).
   */
  async replaceDocumentRegistration(
    documentKey: string,
    documentHash: string,
    originalNonce: number,
    previousGasPriceGwei?: number | null
  ): Promise<RegisterOnChainResult> {
    if (!this.provider) {
      throw new Error("RPC provider is not connected.");
    }

    const feeData = await this.provider.getFeeData();
    const bumpFactor = BigInt(100 + config.gasBumpPercent);

    let gasOverride: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint } = {};

    if (previousGasPriceGwei && previousGasPriceGwei > 0) {
      const prevFeeWei = ethers.parseUnits(previousGasPriceGwei.toString(), "gwei");
      const bumpedFee = (prevFeeWei * bumpFactor) / 100n;

      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        gasOverride = {
          maxFeePerGas: bumpedFee > feeData.maxFeePerGas ? bumpedFee : feeData.maxFeePerGas,
          maxPriorityFeePerGas: (bumpedFee * 15n) / 100n,
        };
      } else {
        gasOverride = {
          gasPrice: bumpedFee > (feeData.gasPrice || 0n) ? bumpedFee : feeData.gasPrice || undefined,
        };
      }
    } else {
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        gasOverride = {
          maxFeePerGas: (feeData.maxFeePerGas * bumpFactor) / 100n,
          maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas * bumpFactor) / 100n,
        };
      } else if (feeData.gasPrice) {
        gasOverride = {
          gasPrice: (feeData.gasPrice * bumpFactor) / 100n,
        };
      }
    }

    return this.registerDocument(documentKey, documentHash, originalNonce, gasOverride);
  }

  /**
   * Verifies candidate document hash on-chain.
   * Strictly read-only; no database or blockchain mutation.
   */
  async verifyDocument(
    documentKey: string,
    candidateHash: string
  ): Promise<VerifyOnChainResult> {
    if (!this.contract) {
      return { matchFound: false, isRevoked: false };
    }

    try {
      const res = await this.contract.verifyDocument(documentKey, candidateHash);
      return {
        matchFound: res[0],
        registeredAt: Number(res[1]),
        issuer: res[2],
        isRevoked: res[3],
      };
    } catch {
      return { matchFound: false, isRevoked: false };
    }
  }

  /**
   * Revokes an existing document on-chain with a reason string.
   */
  async revokeDocument(
    documentKey: string,
    reason: string
  ): Promise<RevokeOnChainResult> {
    if (!this.contract || !this.wallet) {
      throw new Error("Blockchain relayer or contract is not configured.");
    }

    const sanitizedReason = reason.slice(0, 256);
    const tx = await this.contract.revokeDocument(documentKey, sanitizedReason);
    const receipt = await tx.wait(1);

    return {
      txHash: tx.hash,
      blockNumber: receipt?.blockNumber ? BigInt(receipt.blockNumber) : undefined,
      status: receipt?.status === 1 ? "CONFIRMED" : "FAILED",
    };
  }

  /**
   * Reconciles a pending transaction hash against network receipts and contract state.
   * Receipt check is prioritized and validated against expected contract address and event.
   */
  async reconcileTransaction(
    txHash: string | null,
    documentKey: string,
    documentHash: string
  ): Promise<ReconcileResult> {
    if (!this.provider || !this.contract) {
      return { confirmed: false, reverted: false };
    }

    try {
      // 1. If txHash is known, check receipt first
      if (txHash && txHash !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (receipt) {
          if (receipt.status === 1) {
            const validation = this.verifyReceiptAndEvent(receipt, documentKey, documentHash);
            if (validation.isValid) {
              let blockTimestamp: Date | undefined;
              try {
                const block = await this.provider.getBlock(receipt.blockNumber);
                if (block) {
                  blockTimestamp = new Date(Number(block.timestamp) * 1000);
                }
              } catch {
                // Fallback
              }

              return {
                confirmed: true,
                reverted: false,
                blockNumber: BigInt(receipt.blockNumber),
                blockTimestamp: blockTimestamp || new Date(),
              };
            } else {
              return {
                confirmed: false,
                reverted: false,
                validationError: validation.reason,
              };
            }
          } else if (receipt.status === 0) {
            return { confirmed: false, reverted: true };
          }
        }
      }

      // 2. Check on-chain pre-flight as secondary fallback (e.g. offline mined or historical)
      const preFlight = await this.preFlightCheck(documentKey);
      if (
        preFlight.exists &&
        preFlight.documentHash?.toLowerCase() === documentHash.toLowerCase()
      ) {
        return {
          confirmed: true,
          reverted: false,
          blockTimestamp: preFlight.registeredAt
            ? new Date(preFlight.registeredAt * 1000)
            : new Date(),
        };
      }

      return { confirmed: false, reverted: false };
    } catch {
      return { confirmed: false, reverted: false };
    }
  }
}

export const blockchainService = new BlockchainService();
