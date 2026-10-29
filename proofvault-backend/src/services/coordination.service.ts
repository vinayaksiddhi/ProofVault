import { v4 as uuidv4 } from "uuid";
import { prisma } from "../db/client";
import { config } from "../config";
import { TxStatus } from "@prisma/client";

/**
 * CoordinationService manages persistent, database-backed distributed coordination:
 * 1. Nonce reservation: Uses transaction-scoped advisory locks (pg_advisory_xact_lock)
 *    within short (<5ms) interactive Prisma transactions to durably reserve monotonic nonces.
 *    Does NOT hold database transactions open across slow RPC broadcasts.
 * 2. Worker exclusivity: Uses atomic PostgreSQL coordination leases with transaction-scoped
 *    advisory locks to ensure only one worker instance executes at a time across processes,
 *    with automatic TTL expiry to prevent deadlock across process crashes.
 */
export class CoordinationService {
  public static readonly RECONCILIATION_WORKER_LOCK_ID = 1048576;
  public static readonly RELAYER_NONCE_LOCK_ID = 1048577;

  private instanceId: string;
  private isWorkerExecuting = false;
  private leaseInitialized = false;

  constructor() {
    this.instanceId = uuidv4();
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Initializes the coordination lease table idempotently.
   */
  async initCoordination(): Promise<void> {
    if (this.leaseInitialized) return;
    try {
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS sys_worker_coordination (
          lock_id INT PRIMARY KEY,
          owner_id VARCHAR(64) NOT NULL,
          acquired_at TIMESTAMPTZ NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        );
      `;
      this.leaseInitialized = true;
    } catch (err: any) {
      console.warn("[CoordinationService] Lease table init warning:", err.message);
    }
  }

  /**
   * Tries to acquire the global reconciliation worker lock across processes.
   * Uses an atomic transaction-scoped advisory lock to inspect and acquire
   * an exclusive lease in sys_worker_coordination.
   * Releases DB transaction immediately (<5ms); worker executes without holding open DB connections.
   */
  async acquireWorkerLock(leaseDurationSeconds = 120): Promise<boolean> {
    if (this.isWorkerExecuting) {
      return false;
    }

    await this.initCoordination();

    try {
      const acquired = await prisma.$transaction(
        async (tx) => {
          // Transaction-scoped lock for atomic lease check/claim
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(${CoordinationService.RECONCILIATION_WORKER_LOCK_ID});
          `;

          const now = new Date();
          const expiresAt = new Date(now.getTime() + leaseDurationSeconds * 1000);

          // Check for active lease held by a different instance
          const activeRows = await tx.$queryRaw<Array<{ owner_id: string; expires_at: Date }>>`
            SELECT owner_id, expires_at FROM sys_worker_coordination
            WHERE lock_id = 1 AND expires_at > ${now}
            FOR UPDATE;
          `;

          if (activeRows.length > 0 && activeRows[0].owner_id !== this.instanceId) {
            // Another active instance holds the valid lease
            return false;
          }

          // Upsert lease for this instance
          await tx.$executeRaw`
            INSERT INTO sys_worker_coordination (lock_id, owner_id, acquired_at, expires_at)
            VALUES (1, ${this.instanceId}, ${now}, ${expiresAt})
            ON CONFLICT (lock_id) DO UPDATE
            SET owner_id = ${this.instanceId}, acquired_at = ${now}, expires_at = ${expiresAt};
          `;

          return true;
        },
        { timeout: 5000 }
      );

      if (acquired) {
        this.isWorkerExecuting = true;
      }
      return acquired;
    } catch (err: any) {
      console.warn("[CoordinationService] acquireWorkerLock error:", err.message);
      return false;
    }
  }

  /**
   * Releases the reconciliation worker lease for this instance.
   */
  async releaseWorkerLock(): Promise<boolean> {
    this.isWorkerExecuting = false;
    try {
      await prisma.$executeRaw`
        DELETE FROM sys_worker_coordination
        WHERE lock_id = 1 AND owner_id = ${this.instanceId};
      `;
      return true;
    } catch (err: any) {
      console.warn("[CoordinationService] releaseWorkerLock error:", err.message);
      return false;
    }
  }

  /**
   * Durably reserves the next monotonic relayer nonce in a fast (<5ms)
   * transaction-scoped critical section. Commits and releases database locks
   * before any network/RPC calls are made.
   */
  async reserveRelayerNonce(
    documentId: string,
    relayerAddress: string,
    onChainPendingNonce: number,
    idempotencyKey?: string
  ): Promise<{ operationId: string; nonce: number }> {
    return await prisma.$transaction(
      async (tx) => {
        // 1. Transaction-scoped advisory lock for nonce reservation
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(${CoordinationService.RELAYER_NONCE_LOCK_ID});
        `;

        // 2. Query highest assigned nonce across all non-null TransactionOperations
        const latestDbOp = await tx.transactionOperation.findFirst({
          where: {
            nonce: { not: null },
          },
          orderBy: { nonce: "desc" },
        });

        const maxDbNonce = latestDbOp?.nonce ?? -1;
        const reservedNonce = Math.max(onChainPendingNonce, maxDbNonce + 1);

        // 3. Durably persist TransactionOperation with reserved nonce in PENDING status
        const opKey =
          idempotencyKey ||
          `reserve_${documentId}_nonce_${reservedNonce}_${Date.now()}`;

        // Check if an existing pending operation already reserved this key
        const existingOp = await tx.transactionOperation.findUnique({
          where: { idempotencyKey: opKey },
        });

        if (existingOp && existingOp.nonce !== null) {
          return { operationId: existingOp.id, nonce: existingOp.nonce };
        }

        const op = await tx.transactionOperation.create({
          data: {
            documentId,
            chainId: BigInt(config.chainId),
            idempotencyKey: opKey,
            nonce: reservedNonce,
            status: TxStatus.PENDING,
          },
        });

        return { operationId: op.id, nonce: reservedNonce };
      },
      { timeout: 5000 }
    );
  }

  /**
   * Executes a callback within a transaction-scoped advisory lock critical section.
   * Automatically commits/rolls back and releases the lock.
   */
  async withRelayerLock<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(${CoordinationService.RELAYER_NONCE_LOCK_ID});
        `;
        return await fn(tx);
      },
      { timeout: 10000 }
    );
  }
}

export const coordinationService = new CoordinationService();
