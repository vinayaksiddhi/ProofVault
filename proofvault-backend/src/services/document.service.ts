import { v4 as uuidv4 } from "uuid";
import { prisma } from "../db/client";
import { config } from "../config";
import {
  computeSha256,
  sniffMimeType,
  deriveDocumentKey,
  formatBytes32,
  generatePublicVerificationToken,
} from "../utils/crypto.utils";
import { storageService } from "./storage.service";
import { blockchainService } from "./blockchain.service";
import { coordinationService } from "./coordination.service";
import { auditService } from "./audit.service";
import {
  AuditEventType,
  DocumentVisibility,
  RegistrationStatus,
  TxStatus,
} from "@prisma/client";

export interface IngestDocumentParams {
  userId: string;
  fileBuffer: Buffer;
  originalFileName: string;
  title: string;
  description?: string;
  visibility?: DocumentVisibility;
  publishTitle?: boolean;
  publishDescription?: boolean;
  registerOnChain?: boolean;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface DocumentResponseDto {
  documentId: string;
  title: string;
  description: string | null;
  visibility: DocumentVisibility;
  publishTitle: boolean;
  publishDescription: boolean;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  sha256Hash: string;
  registrationStatus: RegistrationStatus;
  publicVerificationToken: string | null;
  createdAt: Date;
  updatedAt: Date;
  blockchainRegistration?: {
    chainId: string;
    contractAddress: string;
    documentKey: string;
    transactionHash: string;
    blockNumber: string | null;
    status: TxStatus;
    isRevoked: boolean;
    revokedAt: Date | null;
    revocationReason: string | null;
    confirmations: number;
  } | null;
}

export class DocumentService {
  /**
   * Ingests a new document according to SOP-ARCH-001 lifecycle.
   */
  async ingestDocument(params: IngestDocumentParams): Promise<{
    document: DocumentResponseDto;
    isDuplicate: boolean;
  }> {
    const {
      userId,
      fileBuffer,
      originalFileName,
      title,
      description,
      visibility = DocumentVisibility.PRIVATE,
      publishTitle = true,
      publishDescription = false,
      registerOnChain = true,
      requestId,
      ip,
      userAgent,
    } = params;

    // 1. File size validation (Hard limit: 25 MiB)
    if (fileBuffer.length > config.maxFileSizeBytes) {
      throw {
        statusCode: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: `File exceeds maximum allowed size of ${config.maxFileSizeBytes} bytes (25 MiB).`,
      };
    }

    if (fileBuffer.length === 0) {
      throw {
        statusCode: 400,
        code: "BAD_REQUEST",
        message: "File buffer is empty (0 bytes).",
      };
    }

    // 2. Magic-byte inspection (not extension/filename alone)
    const detectedMimeType = sniffMimeType(fileBuffer);
    if (!detectedMimeType) {
      throw {
        statusCode: 415,
        code: "UNSUPPORTED_MEDIA_TYPE",
        message:
          "Unsupported file format. Only PDF, PNG, JPEG, and DOCX documents with valid binary headers are accepted.",
      };
    }

    // 3. Exact-byte canonical SHA-256 calculation
    const sha256Hash = computeSha256(fileBuffer);

    // 4. Same-user deduplication check (Decision Q1)
    const existingSameUserDoc = await prisma.document.findFirst({
      where: {
        ownerId: userId,
        sha256Hash,
        isDeleted: false,
      },
      include: {
        registrations: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (existingSameUserDoc) {
      // Discard buffer without disk allocation, log audit event, return existing record
      await auditService.record({
        actorUserId: userId,
        documentId: existingSameUserDoc.id,
        eventType: AuditEventType.DUPLICATE_UPLOAD_BLOCKED,
        result: "SUCCESS",
        requestId,
        ip,
        userAgent,
        metadata: {
          sha256Hash,
          originalFileName,
          action: "RETURNED_EXISTING_DOCUMENT",
        },
      });

      return {
        document: this.mapDocumentToDto(existingSameUserDoc),
        isDuplicate: true,
      };
    }

    // 5. Cross-user check for internal compliance tracking (Decision Q2)
    const crossUserDoc = await prisma.document.findFirst({
      where: {
        sha256Hash,
        isDeleted: false,
        ownerId: { not: userId },
      },
    });

    // 6. Write file to private storage with unguessable UUIDv4 key
    const storageKey = `doc_${uuidv4()}.bin`;
    let fileWritten = false;

    try {
      await storageService.saveFile(storageKey, fileBuffer);
      fileWritten = true;

      // 7. Persist document metadata in PostgreSQL
      const publicVerificationToken =
        visibility === DocumentVisibility.PUBLIC_VERIFIABLE
          ? generatePublicVerificationToken()
          : null;

      const createdDoc = await prisma.document.create({
        data: {
          ownerId: userId,
          title: title.trim().slice(0, 255),
          description: description ? description.trim() : null,
          visibility,
          publishTitle,
          publishDescription,
          originalFileName: originalFileName.slice(0, 255),
          mimeType: detectedMimeType,
          fileSize: BigInt(fileBuffer.length),
          storageKey,
          sha256Hash,
          hashAlgorithm: "SHA-256",
          registrationStatus: RegistrationStatus.UPLOADED,
          publicVerificationToken,
        },
      });

      // Audit log upload
      await auditService.record({
        actorUserId: userId,
        documentId: createdDoc.id,
        eventType: AuditEventType.DOCUMENT_UPLOADED,
        result: "SUCCESS",
        requestId,
        ip,
        userAgent,
        metadata: {
          sha256Hash,
          fileSize: fileBuffer.length,
          mimeType: detectedMimeType,
          crossUserDuplicate: !!crossUserDoc,
        },
      });

      // 8. On-chain registration (if requested)
      if (registerOnChain && blockchainService.isConfigured()) {
        try {
          const documentKey = deriveDocumentKey(createdDoc.id);
          const formattedHash = formatBytes32(sha256Hash);

          // Update status to SUBMITTED_TO_CHAIN
          await prisma.document.update({
            where: { id: createdDoc.id },
            data: { registrationStatus: RegistrationStatus.SUBMITTED_TO_CHAIN },
          });

          // Create persistent TransactionOperation with durably reserved nonce (Decision Q4)
          const idempotencyKey = `reg_${createdDoc.id}`;
          const relayerAddress = blockchainService.getRelayerAddress() || "0x0000000000000000000000000000000000000000";
          const provider = blockchainService.getProvider();
          const onChainPendingNonce = provider ? await provider.getTransactionCount(relayerAddress, "pending") : 0;
          const reservation = await coordinationService.reserveRelayerNonce(
            createdDoc.id,
            relayerAddress,
            onChainPendingNonce,
            idempotencyKey
          );

          const regResult = await blockchainService.registerDocument(
            documentKey,
            formattedHash,
            reservation.nonce
          );

          // Update TransactionOperation with broadcast details
          await prisma.transactionOperation.update({
            where: { id: reservation.operationId },
            data: {
              txHash: regResult.txHash,
              gasPriceGwei: regResult.gasPriceGwei,
              status: regResult.status === "CONFIRMED" ? TxStatus.CONFIRMED : TxStatus.SUBMITTED,
            },
          });

          // Persist BlockchainRegistration record
          await prisma.blockchainRegistration.create({
            data: {
              documentId: createdDoc.id,
              chainId: BigInt(blockchainService.getChainId()),
              contractAddress: blockchainService.getContractAddress(),
              documentKey,
              documentHash: formattedHash,
              issuerAddress: blockchainService.getRelayerAddress() || "0x0000000000000000000000000000000000000000",
              transactionHash: regResult.txHash,
              blockNumber: regResult.blockNumber || null,
              status: regResult.status === "CONFIRMED" ? TxStatus.CONFIRMED : TxStatus.SUBMITTED,
              blockTimestamp: regResult.blockTimestamp || null,
              confirmations: regResult.confirmations,
              isRevoked: false,
            },
          });

          // Update Document registrationStatus
          const finalDocStatus =
            regResult.status === "CONFIRMED"
              ? RegistrationStatus.CONFIRMED_ON_CHAIN
              : RegistrationStatus.SUBMITTED_TO_CHAIN;

          const updatedDoc = await prisma.document.update({
            where: { id: createdDoc.id },
            data: { registrationStatus: finalDocStatus },
            include: {
              registrations: { take: 1 },
            },
          });

          await auditService.record({
            actorUserId: userId,
            documentId: createdDoc.id,
            eventType: AuditEventType.BLOCKCHAIN_CONFIRMED,
            result: regResult.status === "CONFIRMED" ? "SUCCESS" : "FAILURE",
            requestId,
            ip,
            userAgent,
            metadata: {
              txHash: regResult.txHash,
              documentKey,
              status: regResult.status,
            },
          });

          return {
            document: this.mapDocumentToDto(updatedDoc),
            isDuplicate: false,
          };
        } catch (chainErr: any) {
          console.error("[DocumentService] Blockchain registration error:", chainErr.message);
          // Preserve off-chain record honestly (Decision Q5)
          const failedDoc = await prisma.document.update({
            where: { id: createdDoc.id },
            data: { registrationStatus: RegistrationStatus.REGISTRATION_FAILED },
            include: { registrations: { take: 1 } },
          });

          await auditService.record({
            actorUserId: userId,
            documentId: createdDoc.id,
            eventType: AuditEventType.BLOCKCHAIN_FAILED,
            result: "FAILURE",
            requestId,
            ip,
            userAgent,
            metadata: { error: chainErr.message },
          });

          return {
            document: this.mapDocumentToDto(failedDoc),
            isDuplicate: false,
          };
        }
      }

      // Returned without immediate on-chain registration
      const finalDoc = await prisma.document.findUniqueOrThrow({
        where: { id: createdDoc.id },
        include: { registrations: { take: 1 } },
      });

      return {
        document: this.mapDocumentToDto(finalDoc),
        isDuplicate: false,
      };
    } catch (err: any) {
      // Safe cleanup of partially written file (Step 5.10 & SOP-ARCH-001)
      if (fileWritten) {
        await storageService.deleteFile(storageKey).catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Retrieves documents owned by current authenticated user.
   * Strictly read-only; no DB mutation.
   */
  async getUserDocuments(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<DocumentResponseDto[]> {
    const docs = await prisma.document.findMany({
      where: {
        ownerId: userId,
        isDeleted: false,
      },
      include: {
        registrations: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
      skip: offset,
    });

    return docs.map((doc) => this.mapDocumentToDto(doc));
  }

  /**
   * Retrieves single document ensuring ownership or permission isolation.
   * Unauthorized access returns null / 404 to eliminate ID enumeration (SOP-ARCH-003).
   * Strictly read-only; no DB mutation.
   */
  async getDocumentById(
    documentId: string,
    currentUserId: string
  ): Promise<DocumentResponseDto | null> {
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        ownerId: currentUserId,
        isDeleted: false,
      },
      include: {
        registrations: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!doc) {
      return null;
    }

    return this.mapDocumentToDto(doc);
  }

  /**
   * Updates document visibility and manages publicVerificationToken (Decision Q7).
   */
  async updateVisibility(
    documentId: string,
    currentUserId: string,
    visibility: DocumentVisibility,
    publishTitle?: boolean,
    requestId?: string
  ): Promise<DocumentResponseDto> {
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        ownerId: currentUserId,
        isDeleted: false,
      },
    });

    if (!doc) {
      throw {
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Document not found.",
      };
    }

    let publicVerificationToken = doc.publicVerificationToken;
    if (visibility === DocumentVisibility.PUBLIC_VERIFIABLE && !publicVerificationToken) {
      publicVerificationToken = generatePublicVerificationToken();
    } else if (visibility === DocumentVisibility.PRIVATE) {
      // Nullify token on revocation to instantly return 404 on public verify endpoints
      publicVerificationToken = null;
    }

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        visibility,
        publicVerificationToken,
        publishTitle: publishTitle !== undefined ? publishTitle : doc.publishTitle,
      },
      include: {
        registrations: { take: 1 },
      },
    });

    if (requestId) {
      await auditService.record({
        actorUserId: currentUserId,
        documentId: doc.id,
        eventType: AuditEventType.VISIBILITY_CHANGED,
        result: "SUCCESS",
        requestId,
        metadata: { visibility, publicTokenNullified: visibility === DocumentVisibility.PRIVATE },
      });
    }

    return this.mapDocumentToDto(updated);
  }

  /**
   * Soft-deletes document record and permanently purges raw file bytes (Decision Q9).
   */
  async deleteDocument(
    documentId: string,
    currentUserId: string,
    requestId: string
  ): Promise<void> {
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        ownerId: currentUserId,
        isDeleted: false,
      },
    });

    if (!doc) {
      throw {
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Document not found.",
      };
    }

    // 1. Purge private file bytes immediately
    await storageService.deleteFile(doc.storageKey);

    // 2. Soft-delete document row & nullify public token
    await prisma.document.update({
      where: { id: doc.id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        publicVerificationToken: null,
      },
    });

    // 3. Record audit tombstone
    await auditService.record({
      actorUserId: currentUserId,
      documentId: doc.id,
      eventType: AuditEventType.DOCUMENT_DELETED,
      result: "SUCCESS",
      requestId,
      metadata: { storageKeyPurged: true },
    });
  }

  /**
   * Revokes on-chain registration and updates database state.
   */
  async revokeDocument(
    documentId: string,
    currentUserId: string,
    reason: string,
    requestId: string
  ): Promise<DocumentResponseDto> {
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        ownerId: currentUserId,
        isDeleted: false,
      },
      include: {
        registrations: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!doc) {
      throw {
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Document not found.",
      };
    }

    const registration = doc.registrations[0];
    if (!registration) {
      throw {
        statusCode: 400,
        code: "BAD_REQUEST",
        message: "Document does not have an active blockchain registration.",
      };
    }

    if (registration.isRevoked) {
      throw {
        statusCode: 409,
        code: "CONFLICT",
        message: "Document has already been revoked on-chain.",
      };
    }

    // 1. Broadcast on-chain revocation if configured
    if (blockchainService.isConfigured()) {
      await blockchainService.revokeDocument(registration.documentKey, reason);
    }

    // 2. Update BlockchainRegistration state
    const now = new Date();
    await prisma.blockchainRegistration.update({
      where: { id: registration.id },
      data: {
        isRevoked: true,
        revokedAt: now,
        revocationReason: reason.slice(0, 256),
      },
    });

    // 3. Audit log
    await auditService.record({
      actorUserId: currentUserId,
      documentId: doc.id,
      eventType: AuditEventType.BLOCKCHAIN_REVOKED,
      result: "SUCCESS",
      requestId,
      metadata: { reason, revokedAt: now },
    });

    const refreshed = await prisma.document.findUniqueOrThrow({
      where: { id: doc.id },
      include: { registrations: { take: 1 } },
    });

    return this.mapDocumentToDto(refreshed);
  }

  /**
   * Private document verification: authenticated user re-uploads candidate file.
   * Compares recomputed SHA-256 against database record and blockchain state.
   * Strictly read-only; no DB mutation.
   */
  async verifyPrivateDocument(
    documentId: string,
    currentUserId: string,
    candidateBuffer: Buffer,
    requestId: string
  ): Promise<{
    matchFound: boolean;
    computedHash: string;
    registeredHash: string;
    registrationStatus: RegistrationStatus;
    onChainVerification?: {
      matchFound: boolean;
      registeredAt?: number;
      isRevoked: boolean;
    };
  }> {
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        ownerId: currentUserId,
        isDeleted: false,
      },
      include: {
        registrations: { take: 1 },
      },
    });

    if (!doc) {
      throw {
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Document not found.",
      };
    }

    const computedHash = computeSha256(candidateBuffer);
    const matchFound = computedHash.toLowerCase() === doc.sha256Hash.toLowerCase();

    let onChainVerification;
    if (doc.registrations[0] && blockchainService.isConfigured()) {
      onChainVerification = await blockchainService.verifyDocument(
        doc.registrations[0].documentKey,
        formatBytes32(computedHash)
      );
    }

    await auditService.record({
      actorUserId: currentUserId,
      documentId: doc.id,
      eventType: AuditEventType.VERIFICATION_ATTEMPTED,
      result: matchFound ? "SUCCESS" : "MISMATCH",
      requestId,
      metadata: { matchFound, isPrivate: true },
    });

    return {
      matchFound,
      computedHash,
      registeredHash: doc.sha256Hash,
      registrationStatus: doc.registrationStatus,
      onChainVerification,
    };
  }

  /**
   * Public verification lookup: strictly sanitized DTO (Decision Q8).
   * Zero personal data, email, storageKey, or file bytes exposed.
   * Strictly read-only; no DB mutation.
   */
  async getPublicVerificationData(token: string): Promise<Record<string, any> | null> {
    if (!token || token.length !== 64) {
      return null;
    }

    const doc = await prisma.document.findFirst({
      where: {
        publicVerificationToken: token,
        visibility: DocumentVisibility.PUBLIC_VERIFIABLE,
        isDeleted: false,
      },
      include: {
        registrations: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!doc) {
      return null;
    }

    const reg = doc.registrations[0];

    return {
      title: doc.publishTitle ? doc.title : "Confidential Document",
      description: doc.publishDescription ? doc.description : null,
      canonicalSha256Hash: doc.sha256Hash,
      hashAlgorithm: doc.hashAlgorithm,
      registrationStatus: doc.registrationStatus,
      blockchain: reg
        ? {
            chainId: reg.chainId.toString(),
            contractAddress: reg.contractAddress,
            documentKey: reg.documentKey,
            transactionHash: reg.transactionHash,
            blockNumber: reg.blockNumber ? reg.blockNumber.toString() : null,
            registeredAt: reg.registeredAt,
            isRevoked: reg.isRevoked,
            revokedAt: reg.revokedAt,
          }
        : null,
      verifiedAt: new Date(),
    };
  }

  /**
   * Triggers manual on-chain registration for an uploaded or failed document (Decision Q5).
   */
  async registerDocumentOnChain(
    documentId: string,
    currentUserId: string,
    requestId: string
  ): Promise<DocumentResponseDto> {
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        ownerId: currentUserId,
        isDeleted: false,
      },
      include: {
        registrations: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!doc) {
      throw {
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Document not found.",
      };
    }

    if (doc.registrationStatus === RegistrationStatus.CONFIRMED_ON_CHAIN) {
      throw {
        statusCode: 409,
        code: "CONFLICT",
        message: "Document is already confirmed on-chain.",
      };
    }

    if (!blockchainService.isConfigured()) {
      throw {
        statusCode: 503,
        code: "BLOCKCHAIN_RPC_ERROR",
        message: "Blockchain relayer is not configured.",
      };
    }

    const documentKey = deriveDocumentKey(doc.id);
    const formattedHash = formatBytes32(doc.sha256Hash);

    // Pre-flight check
    const preFlight = await blockchainService.preFlightCheck(documentKey);
    if (preFlight.exists) {
      const updated = await prisma.document.update({
        where: { id: doc.id },
        data: { registrationStatus: RegistrationStatus.CONFIRMED_ON_CHAIN },
        include: { registrations: { take: 1 } },
      });
      return this.mapDocumentToDto(updated);
    }

    // Update status to SUBMITTED_TO_CHAIN
    await prisma.document.update({
      where: { id: doc.id },
      data: { registrationStatus: RegistrationStatus.SUBMITTED_TO_CHAIN },
    });

    const idempotencyKey = `reg_${doc.id}_manual_${Date.now()}`;
    const relayerAddress = blockchainService.getRelayerAddress() || "0x0000000000000000000000000000000000000000";
    const provider = blockchainService.getProvider();
    const onChainPendingNonce = provider ? await provider.getTransactionCount(relayerAddress, "pending") : 0;
    const reservation = await coordinationService.reserveRelayerNonce(
      doc.id,
      relayerAddress,
      onChainPendingNonce,
      idempotencyKey
    );

    const regResult = await blockchainService.registerDocument(
      documentKey,
      formattedHash,
      reservation.nonce
    );

    await prisma.transactionOperation.update({
      where: { id: reservation.operationId },
      data: {
        txHash: regResult.txHash,
        gasPriceGwei: regResult.gasPriceGwei,
        status: regResult.status === "CONFIRMED" ? TxStatus.CONFIRMED : TxStatus.SUBMITTED,
      },
    });

    if (doc.registrations[0]) {
      await prisma.blockchainRegistration.update({
        where: { id: doc.registrations[0].id },
        data: {
          transactionHash: regResult.txHash,
          blockNumber: regResult.blockNumber || null,
          status: regResult.status === "CONFIRMED" ? TxStatus.CONFIRMED : TxStatus.SUBMITTED,
          blockTimestamp: regResult.blockTimestamp || null,
          confirmations: regResult.confirmations,
        },
      });
    } else {
      await prisma.blockchainRegistration.create({
        data: {
          documentId: doc.id,
          chainId: BigInt(blockchainService.getChainId()),
          contractAddress: blockchainService.getContractAddress(),
          documentKey,
          documentHash: formattedHash,
          issuerAddress: blockchainService.getRelayerAddress() || "0x0000000000000000000000000000000000000000",
          transactionHash: regResult.txHash,
          blockNumber: regResult.blockNumber || null,
          status: regResult.status === "CONFIRMED" ? TxStatus.CONFIRMED : TxStatus.SUBMITTED,
          blockTimestamp: regResult.blockTimestamp || null,
          confirmations: regResult.confirmations,
          isRevoked: false,
        },
      });
    }

    const finalDocStatus =
      regResult.status === "CONFIRMED"
        ? RegistrationStatus.CONFIRMED_ON_CHAIN
        : RegistrationStatus.SUBMITTED_TO_CHAIN;

    const finalDoc = await prisma.document.update({
      where: { id: doc.id },
      data: { registrationStatus: finalDocStatus },
      include: { registrations: { take: 1 } },
    });

    return this.mapDocumentToDto(finalDoc);
  }

  /**
   * Retrieves full transaction operation history and current on-chain status.
   */
  async getChainStatus(documentId: string, currentUserId: string): Promise<Record<string, any>> {
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        ownerId: currentUserId,
        isDeleted: false,
      },
      include: {
        registrations: { orderBy: { createdAt: "desc" }, take: 1 },
        txOperations: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!doc) {
      throw {
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Document not found.",
      };
    }

    const documentKey = deriveDocumentKey(doc.id);
    const preFlight = await blockchainService.preFlightCheck(documentKey);

    return {
      documentId: doc.id,
      registrationStatus: doc.registrationStatus,
      documentKey,
      onChainConfirmed: preFlight.exists,
      onChainDetails: preFlight.exists ? preFlight : null,
      latestRegistration: doc.registrations[0]
        ? {
            chainId: doc.registrations[0].chainId.toString(),
            contractAddress: doc.registrations[0].contractAddress,
            transactionHash: doc.registrations[0].transactionHash,
            status: doc.registrations[0].status,
            isRevoked: doc.registrations[0].isRevoked,
            revokedAt: doc.registrations[0].revokedAt,
            revocationReason: doc.registrations[0].revocationReason,
          }
        : null,
      operations: doc.txOperations.map((op) => ({
        operationId: op.id,
        idempotencyKey: op.idempotencyKey,
        txHash: op.txHash,
        nonce: op.nonce,
        gasPriceGwei: op.gasPriceGwei ? Number(op.gasPriceGwei) : null,
        status: op.status,
        retryCount: op.retryCount,
        maxRetries: op.maxRetries,
        lastError: op.lastError,
        createdAt: op.createdAt,
        updatedAt: op.updatedAt,
      })),
    };
  }

  /**
   * Helper to map Prisma document model to API response DTO.
   */
  private mapDocumentToDto(doc: any): DocumentResponseDto {
    const reg = doc.registrations && doc.registrations[0] ? doc.registrations[0] : null;

    return {
      documentId: doc.id,
      title: doc.title,
      description: doc.description,
      visibility: doc.visibility,
      publishTitle: doc.publishTitle,
      publishDescription: doc.publishDescription,
      originalFileName: doc.originalFileName,
      fileSize: Number(doc.fileSize),
      mimeType: doc.mimeType,
      sha256Hash: doc.sha256Hash,
      registrationStatus: doc.registrationStatus,
      publicVerificationToken: doc.publicVerificationToken,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      blockchainRegistration: reg
        ? {
            chainId: reg.chainId.toString(),
            contractAddress: reg.contractAddress,
            documentKey: reg.documentKey,
            transactionHash: reg.transactionHash,
            blockNumber: reg.blockNumber ? reg.blockNumber.toString() : null,
            status: reg.status,
            isRevoked: reg.isRevoked,
            revokedAt: reg.revokedAt,
            revocationReason: reg.revocationReason,
            confirmations: reg.confirmations,
          }
        : null,
    };
  }
}

export const documentService = new DocumentService();
