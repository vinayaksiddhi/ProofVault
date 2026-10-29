import crypto from "crypto";
import bcrypt from "bcryptjs";
import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Computes canonical lowercase 64-character SHA-256 hex digest over raw bytes.
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").toLowerCase();
}

/**
 * Validates the file buffer by sniffing its magic bytes.
 * Whitelist: application/pdf, image/png, image/jpeg,
 * application/vnd.openxmlformats-officedocument.wordprocessingml.document (docx)
 */
export function sniffMimeType(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // 1. PDF: %PDF- (0x25 0x50 0x44 0x46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "application/pdf";
  }

  // 2. PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // 3. JPEG: 0xFF 0xD8 0xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // 4. DOCX (ZIP container): 0x50 0x4B 0x03 0x04 or 0x50 0x4B 0x05 0x06
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return null;
}

/**
 * Hashes a plaintext password using bcrypt with work factor 12.
 */
export async function hashPassword(plainText: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(plainText, salt);
}

/**
 * Validates a plaintext password against a stored bcrypt hash.
 */
export async function comparePassword(
  plainText: string,
  storedHash: string
): Promise<boolean> {
  return bcrypt.compare(plainText, storedHash);
}

/**
 * Generates an unguessable 256-bit (64 hex characters) public verification token.
 */
export function generatePublicVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Derives the on-chain bytes32 documentKey from documentId UUID:
 * documentKey = keccak256(bytes(documentId))
 */
export function deriveDocumentKey(documentId: string): string {
  return keccak256(toUtf8Bytes(documentId));
}

/**
 * Formats a 64-char hex string as a 0x-prefixed bytes32 hex string.
 */
export function formatBytes32(hexString: string): string {
  const clean = hexString.replace(/^0x/, "").toLowerCase();
  if (clean.length !== 64) {
    throw new Error(`Invalid 32-byte hex string length: ${clean.length}`);
  }
  return `0x${clean}`;
}
