import { prisma } from "../db/client";
import { config } from "../config";
import { blockchainService } from "../services/blockchain.service";
import { coordinationService } from "../services/coordination.service";
import { auditService } from "../services/audit.service";
import { deriveDocumentKey, formatBytes32 } from "../utils/crypto.utils";
import { AuditEventType, RegistrationStatus, TxStatus } from "@prisma/client";

export class ReconciliationWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Starts the reconciliation worker periodic polling.
   */
  start(intervalMs = config.reconciliationIntervalMs): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    console.log(`[ReconciliationWorker] Started with interval ${intervalMs}ms`);

    // Run first cycle shortly after start, then schedule recurring runs
    setTimeout(() => {
      this.runOnce().catch((err) => {
        console.error("[ReconciliationWorker] Error in initial run:", err.message);
      });
    }, 1000);

    this.timer = setInterval(async () => {
      try {
        await this.runOnce();
      } catch (err: any) {
        console.error("[ReconciliationWorker] Error during reconciliation cycle:", err.message);
      }
    }, intervalMs);
  }

  /**
   * Stops the reconciliation worker.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log("[ReconciliationWorker] Stopped.");
  }

  /**
   * Executes a single reconciliation cycle.
   * Can be called manually or in automated unit/integration tests.
   */
  async runOnce(): Promise<{
    processedCount: number;
    confirmedCount: number;
    revertedCount: number;
    replacedCount: number;
    stalledCount: number;
  }> {
    const stats = {
      processedCount: 0,
      confirmedCount: 0,
      revertedCount: 0,
      replacedCount: 0,
      stalledCount: 0,
    };

    // 1. Acquire distributed database lease to prevent concurrent worker execution
    const lockAcquired = await coordinationService.acquireWorkerLock();
    if (!lockAcquired) {
      return stats;
    }

    try {
      // 2. Fetch documents with pending or submitted operations
      const pendingOperations = await prisma.transactionOperation.findMany({
        where: {
          status: { in: [TxStatus.SUBMITTED, TxStatus.PENDING] },
        },
        include: {
          document: {
            include: {
              registrations: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      // Also check for documents in SUBMITTED_TO_CHAIN that might have missed a TxOperation during an abrupt crash
      const orphanedDocuments = await prisma.document.findMany({
        where: {
          registrationStatus: RegistrationStatus.SUBMITTED_TO_CHAIN,
          txOperations: {
            none: {
              status: { in: [TxStatus.SUBMITTED, TxStatus.PENDING] },
            },
          },
        },
        include: {
          registrations: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      stats.processedCount = pendingOperations.length + orphanedDocuments.length;

      // Group operations by document to resolve replacement races atomically
      const processedDocIds = new Set<string>();

      for (const op of pendingOperations) {
        const doc = op.document;
        if (!doc || processedDocIds.has(doc.id)) continue;
        processedDocIds.add(doc.id);

        const documentKey = deriveDocumentKey(doc.id);
        const documentHash = formatBytes32(doc.sha256Hash);

        try {
          // Idempotency: if already confirmed on-chain, skip mutating
          if (doc.registrationStatus === RegistrationStatus.CONFIRMED_ON_CHAIN) {
            continue;
          }

          // Fetch ALL operations for this document to handle replacement races (original-first vs replacement-first)
          const allDocOps = await prisma.transactionOperation.findMany({
            where: { documentId: doc.id },
            orderBy: { createdAt: "desc" },
          });

          let canonicalMinedOp: (typeof allDocOps)[0] | null = null;
          let canonicalReconcileResult: any = null;
          let hasRevertedOp = false;

          // Check receipts for all operations associated with this document
          for (const candidateOp of allDocOps) {
            if (!candidateOp.txHash) continue;

            const reconciliation = await blockchainService.reconcileTransaction(
              candidateOp.txHash,
              documentKey,
              documentHash
            );

            if (reconciliation.confirmed) {
              // Found the canonical mined transaction!
              canonicalMinedOp = candidateOp;
              canonicalReconcileResult = reconciliation;
              break;
            } else if (reconciliation.reverted) {
              hasRevertedOp = true;
            }
          }

          // If no receipt matched, check on-chain pre-flight as secondary fallback
          if (!canonicalMinedOp) {
            const preFlight = await blockchainService.preFlightCheck(documentKey);
            if (
              preFlight.exists &&
              preFlight.documentHash?.toLowerCase() === documentHash.toLowerCase()
            ) {
              // The document was registered on chain (e.g. mined while backend was offline or via earlier hash)
              canonicalMinedOp = allDocOps[0]; // Most recent attempt
              canonicalReconcileResult = {
                confirmed: true,
                reverted: false,
                blockTimestamp: preFlight.registeredAt
                  ? new Date(preFlight.registeredAt * 1000)
                  : new Date(),
              };
            }
          }

          if (canonicalMinedOp && canonicalReconcileResult) {
            // Case 1: Transaction succeeded and was mined on-chain!
            const canonicalTxHash = canonicalMinedOp.txHash || "0x0000000000000000000000000000000000000000000000000000000000000000";

            await prisma.$transaction([
              // 1. Mark canonical mined operation as CONFIRMED
              prisma.transactionOperation.update({
                where: { id: canonicalMinedOp.id },
                data: {
                  status: TxStatus.CONFIRMED,
                  updatedAt: new Date(),
                },
              }),
              // 2. Mark any other sibling operations as REPLACED (superseded)
              prisma.transactionOperation.updateMany({
                where: {
                  documentId: doc.id,
                  id: { not: canonicalMinedOp.id },
                  status: { in: [TxStatus.SUBMITTED, TxStatus.PENDING] },
                },
                data: {
                  status: TxStatus.REPLACED,
                  lastError: `Superseded by canonical mined transaction ${canonicalTxHash}`,
                  updatedAt: new Date(),
                },
              }),
              // 3. Mark document as CONFIRMED_ON_CHAIN
              prisma.document.update({
                where: { id: doc.id },
                data: {
                  registrationStatus: RegistrationStatus.CONFIRMED_ON_CHAIN,
                  updatedAt: new Date(),
                },
              }),
            ]);

            // Ensure BlockchainRegistration record reflects the canonical mined hash & block
            if (doc.registrations[0]) {
              await prisma.blockchainRegistration.update({
                where: { id: doc.registrations[0].id },
                data: {
                  transactionHash: canonicalTxHash,
                  status: TxStatus.CONFIRMED,
                  blockNumber: canonicalReconcileResult.blockNumber || doc.registrations[0].blockNumber,
                  blockTimestamp: canonicalReconcileResult.blockTimestamp || doc.registrations[0].blockTimestamp,
                  confirmations: 1,
                  updatedAt: new Date(),
                },
              });
            } else {
              await prisma.blockchainRegistration.create({
                data: {
                  documentId: doc.id,
                  chainId: BigInt(blockchainService.getChainId()),
                  contractAddress: blockchainService.getContractAddress(),
                  documentKey,
                  documentHash,
                  issuerAddress: blockchainService.getRelayerAddress() || "0x0000000000000000000000000000000000000000",
                  transactionHash: canonicalTxHash,
                  blockNumber: canonicalReconcileResult.blockNumber || null,
                  status: TxStatus.CONFIRMED,
                  blockTimestamp: canonicalReconcileResult.blockTimestamp || new Date(),
                  confirmations: 1,
                },
              });
            }

            await auditService.record({
              actorUserId: null,
              documentId: doc.id,
              eventType: AuditEventType.BLOCKCHAIN_CONFIRMED,
              result: "SUCCESS",
              requestId: `reconcile-${canonicalMinedOp.id.slice(0, 8)}`,
              metadata: {
                canonicalTxHash,
                documentKey,
                reconciledVia: "ReconciliationWorker",
              },
            });

            stats.confirmedCount++;
          } else if (hasRevertedOp && allDocOps.every((o) => o.status === TxStatus.FAILED || o.id === op.id)) {
            // Case 2: Transaction reverted on-chain (status 0)
            await prisma.$transaction([
              prisma.transactionOperation.update({
                where: { id: op.id },
                data: {
                  status: TxStatus.FAILED,
                  lastError: "Transaction reverted on-chain (status 0)",
                  updatedAt: new Date(),
                },
              }),
              prisma.document.update({
                where: { id: doc.id },
                data: {
                  registrationStatus: RegistrationStatus.REGISTRATION_FAILED,
                  updatedAt: new Date(),
                },
              }),
            ]);

            if (doc.registrations[0]) {
              await prisma.blockchainRegistration.update({
                where: { id: doc.registrations[0].id },
                data: { status: TxStatus.FAILED, updatedAt: new Date() },
              });
            }

            await auditService.record({
              actorUserId: null,
              documentId: doc.id,
              eventType: AuditEventType.BLOCKCHAIN_FAILED,
              result: "FAILURE",
              requestId: `reconcile-${op.id.slice(0, 8)}`,
              metadata: {
                txHash: op.txHash,
                reason: "TRANSACTION_REVERTED_ON_CHAIN",
              },
            });

            stats.revertedCount++;
          } else {
            // Case 3: Still pending in mempool (receipt is null)
            const operationAgeMs = Date.now() - op.createdAt.getTime();

            if (operationAgeMs >= config.staleTransactionThresholdMs) {
              if (op.retryCount < op.maxRetries && op.nonce !== null) {
                // Perform gas fee-bump replacement with same nonce (Decision Q4)
                try {
                  const newRetryCount = op.retryCount + 1;
                  const replacementRes = await blockchainService.replaceDocumentRegistration(
                    documentKey,
                    documentHash,
                    op.nonce,
                    op.gasPriceGwei ? Number(op.gasPriceGwei) : null
                  );

                  // Mark old operation REPLACED and create new operation record
                  await prisma.$transaction([
                    prisma.transactionOperation.update({
                      where: { id: op.id },
                      data: {
                        status: TxStatus.REPLACED,
                        lastError: `Replaced by transaction ${replacementRes.txHash}`,
                        updatedAt: new Date(),
                      },
                    }),
                    prisma.transactionOperation.create({
                      data: {
                        documentId: doc.id,
                        chainId: op.chainId,
                        idempotencyKey: `replace_${op.id}_retry_${newRetryCount}`,
                        txHash: replacementRes.txHash,
                        nonce: op.nonce,
                        gasPriceGwei: replacementRes.gasPriceGwei || op.gasPriceGwei,
                        status:
                          replacementRes.status === "CONFIRMED"
                            ? TxStatus.CONFIRMED
                            : TxStatus.SUBMITTED,
                        retryCount: newRetryCount,
                        maxRetries: op.maxRetries,
                      },
                    }),
                  ]);

                  if (replacementRes.status === "CONFIRMED") {
                    await prisma.document.update({
                      where: { id: doc.id },
                      data: { registrationStatus: RegistrationStatus.CONFIRMED_ON_CHAIN },
                    });
                    stats.confirmedCount++;
                  }

                  stats.replacedCount++;
                } catch (replaceErr: any) {
                  console.warn(
                    `[ReconciliationWorker] Replacement failed for operation ${op.id}:`,
                    replaceErr.message
                  );
                }
              } else if (op.retryCount >= op.maxRetries) {
                // Max retries exceeded without confirmation -> STALLED_NEEDS_RECONCILIATION
                await prisma.$transaction([
                  prisma.transactionOperation.update({
                    where: { id: op.id },
                    data: {
                      status: TxStatus.FAILED,
                      lastError: `Exceeded max retries (${op.maxRetries}) without receiving confirmation.`,
                      updatedAt: new Date(),
                    },
                  }),
                  prisma.document.update({
                    where: { id: doc.id },
                    data: {
                      registrationStatus: RegistrationStatus.STALLED_NEEDS_RECONCILIATION,
                      updatedAt: new Date(),
                    },
                  }),
                ]);

                stats.stalledCount++;
              }
            }
          }
        } catch (opErr: any) {
          // RPC outage / connection issue: do NOT corrupt database state
          console.warn(
            `[ReconciliationWorker] Non-fatal error checking operation ${op.id}:`,
            opErr.message
          );
        }
      }

      // 4. Reconcile orphaned documents (e.g. process crashed before TxOperation could be recorded)
      for (const orphan of orphanedDocuments) {
        const documentKey = deriveDocumentKey(orphan.id);
        const documentHash = formatBytes32(orphan.sha256Hash);

        try {
          const preFlight = await blockchainService.preFlightCheck(documentKey);
          if (preFlight.exists && preFlight.documentHash?.toLowerCase() === documentHash.toLowerCase()) {
            await prisma.document.update({
              where: { id: orphan.id },
              data: { registrationStatus: RegistrationStatus.CONFIRMED_ON_CHAIN },
            });

            if (orphan.registrations[0]) {
              await prisma.blockchainRegistration.update({
                where: { id: orphan.registrations[0].id },
                data: { status: TxStatus.CONFIRMED },
              });
            }

            stats.confirmedCount++;
          }
        } catch (orphanErr: any) {
          console.warn(
            `[ReconciliationWorker] Error checking orphan document ${orphan.id}:`,
            orphanErr.message
          );
        }
      }

      return stats;
    } finally {
      // 5. Always release distributed database lease
      await coordinationService.releaseWorkerLock();
    }
  }
}

export const reconciliationWorker = new ReconciliationWorker();
