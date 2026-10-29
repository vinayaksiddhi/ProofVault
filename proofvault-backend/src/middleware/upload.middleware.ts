import multer from "multer";
import { config } from "../config";

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: config.maxFileSizeBytes, // 25 MiB max
    files: 1,
  },
});
