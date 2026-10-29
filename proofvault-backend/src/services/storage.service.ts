import fs from "fs/promises";
import path from "path";
import { config } from "../config";

export class StorageService {
  private baseDir: string;

  constructor() {
    this.baseDir = config.localStoragePath;
  }

  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (err: any) {
      if (err.code !== "EEXIST") {
        throw err;
      }
    }
  }

  /**
   * Resolves the absolute path for a given storageKey, preventing path traversal attacks.
   */
  private getFilePath(storageKey: string): string {
    const sanitizedKey = path.basename(storageKey);
    return path.join(this.baseDir, sanitizedKey);
  }

  /**
   * Writes the file buffer to private disk storage using the UUID storageKey.
   */
  async saveFile(storageKey: string, buffer: Buffer): Promise<void> {
    await this.ensureStorageDir();
    const filePath = this.getFilePath(storageKey);
    await fs.writeFile(filePath, buffer, { mode: 0o600 });
  }

  /**
   * Reads raw file bytes from private storage.
   */
  async readFile(storageKey: string): Promise<Buffer> {
    const filePath = this.getFilePath(storageKey);
    return fs.readFile(filePath);
  }

  /**
   * Checks whether the file exists in private storage.
   */
  async fileExists(storageKey: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(storageKey);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Permanently unlinks the file from private storage.
   */
  async deleteFile(storageKey: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(storageKey);
      await fs.unlink(filePath);
      return true;
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  /**
   * Safely deletes an ephemeral file or path during cleanup.
   */
  async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}

export const storageService = new StorageService();
