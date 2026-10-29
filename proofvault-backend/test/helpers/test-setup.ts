import { prisma } from "../../src/db/client";
import { storageService } from "../../src/services/storage.service";
import fs from "fs/promises";
import path from "path";

export async function clearTestData(): Promise<void> {
  // Delete test records in foreign key order without dropping tables
  await prisma.auditLog.deleteMany({});
  await prisma.transactionOperation.deleteMany({});
  await prisma.blockchainRegistration.deleteMany({});
  await prisma.documentPermission.deleteMany({});
  await prisma.document.deleteMany({});
  await prisma.user.deleteMany({});

  // Clean test storage directory
  try {
    const files = await fs.readdir(storageService["baseDir"]);
    for (const file of files) {
      if (file.startsWith("doc_") || file.endsWith(".bin")) {
        await fs.unlink(path.join(storageService["baseDir"], file)).catch(() => {});
      }
    }
  } catch {
    // Directory might not exist yet
  }
}

/**
 * Creates minimal valid sample buffers for testing:
 * - PDF: starts with %PDF-1.4
 * - PNG: starts with \x89PNG\r\n\x1a\n
 * - Fake text file disguised as PDF: "Hello World"
 */
export const SAMPLE_BUFFERS = {
  validPdf: Buffer.from("%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\ntrailer\n<<\n>>\n%%EOF"),
  validPng: Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]),
  fakePdf: Buffer.from("This is a plain text file pretending to be a PDF"),
};
