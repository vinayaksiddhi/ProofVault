import { Router, Request, Response, NextFunction } from "express";
import { documentService } from "../services/document.service";
import { uploadMiddleware } from "../middleware/upload.middleware";
import { computeSha256 } from "../utils/crypto.utils";
import { sendSuccess, sendError } from "../utils/response.utils";

export const publicRouter = Router();

/**
 * GET /api/v1/public/verify/:token
 * Public verification endpoint with strictly sanitized DTO (Decision Q8)
 */
publicRouter.get(
  "/verify/:token",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.params.token;
      const requestId = req.requestId || "req-unknown";

      const data = await documentService.getPublicVerificationData(token);
      if (!data) {
        sendError(
          res,
          "NOT_FOUND",
          "Verification token not found or document is not publicly verifiable.",
          404,
          {},
          requestId
        );
        return;
      }

      sendSuccess(res, data, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/public/verify/:token/check
 * Re-hashes uploaded candidate file in-memory and compares against registered hash.
 * File is discarded immediately after hashing; never written to disk (SOP-ARCH-003).
 */
publicRouter.post(
  "/verify/:token/check",
  uploadMiddleware.single("file"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.params.token;
      const requestId = req.requestId || "req-unknown";
      const file = req.file;

      if (!file) {
        sendError(res, "BAD_REQUEST", "No candidate file provided.", 400, {}, requestId);
        return;
      }

      const publicData = await documentService.getPublicVerificationData(token);
      if (!publicData) {
        sendError(
          res,
          "NOT_FOUND",
          "Verification token not found or document is not publicly verifiable.",
          404,
          {},
          requestId
        );
        return;
      }

      // Re-hash strictly in memory
      const candidateHash = computeSha256(file.buffer);
      const isMatch =
        candidateHash.toLowerCase() === publicData.canonicalSha256Hash.toLowerCase();

      sendSuccess(
        res,
        {
          matchFound: isMatch,
          computedCandidateHash: candidateHash,
          registeredHash: publicData.canonicalSha256Hash,
          isRevoked: publicData.blockchain?.isRevoked || false,
          verifiedAt: new Date(),
        },
        200
      );
    } catch (err) {
      next(err);
    }
  }
);
