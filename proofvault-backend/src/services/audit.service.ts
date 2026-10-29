import crypto from "crypto";
import { prisma } from "../db/client";
import { AuditEventType } from "@prisma/client";

export interface CreateAuditLogParams {
  actorUserId?: string | null;
  documentId?: string | null;
  eventType: AuditEventType;
  result: "SUCCESS" | "FAILURE" | "MISMATCH";
  requestId: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any> | null;
}

export class AuditService {
  /**
   * Hashes client IP address with a salt for privacy compliance (Decision Q8 & SOP-ARCH-003).
   */
  private hashIp(ip?: string | null): string | null {
    if (!ip) return null;
    const salt = "proofvault-ip-salt-audit-protection";
    return crypto.createHash("sha256").update(`${ip}:${salt}`).digest("hex").slice(0, 32);
  }

  /**
   * Sanitizes audit metadata to prevent accidental leakage of secrets, keys, or file bytes.
   */
  private sanitizeMetadata(metadata?: Record<string, any> | null): Record<string, any> | null {
    if (!metadata) return null;
    const sensitiveKeys = [
      "password",
      "passwordHash",
      "token",
      "jwt",
      "secret",
      "privateKey",
      "relayerPrivateKey",
      "buffer",
      "fileBytes",
    ];

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Persists an append-only audit event in PostgreSQL.
   */
  async record(params: CreateAuditLogParams): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: params.actorUserId || null,
          documentId: params.documentId || null,
          eventType: params.eventType,
          result: params.result,
          requestId: params.requestId,
          ipHash: this.hashIp(params.ip),
          userAgent: params.userAgent ? params.userAgent.slice(0, 255) : null,
          metadata: this.sanitizeMetadata(params.metadata) as any,
        },
      });
    } catch (err: any) {
      // Audit log write failure should not crash the main application, but should be logged to stderr
      console.error("[AuditService] Failed to record audit log:", err.message);
    }
  }
}

export const auditService = new AuditService();
