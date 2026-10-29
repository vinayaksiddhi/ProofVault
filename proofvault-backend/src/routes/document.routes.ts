import { Router, Request, Response, NextFunction } from "express";
import { documentService } from "../services/document.service";
import { requireAuth } from "../middleware/auth.middleware";
import { uploadMiddleware } from "../middleware/upload.middleware";
import { sendSuccess, sendError } from "../utils/response.utils";
import { DocumentVisibility } from "@prisma/client";

export const documentRouter = Router();

// All document routes require authentication
documentRouter.use(requireAuth);

/**
 * POST /api/v1/documents
 * Multipart upload for document ingestion
 */
documentRouter.post(
  "/",
  uploadMiddleware.single("file"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const requestId = req.requestId || "req-unknown";
      const file = req.file;

      if (!file) {
        sendError(res, "BAD_REQUEST", "No file provided in multipart 'file' field.", 400, {}, requestId);
        return;
      }

      const {
        title,
        description,
        visibility = "PRIVATE",
        publishTitle = "true",
        publishDescription = "false",
        registerOnChain = "true",
      } = req.body || {};

      if (!title || typeof title !== "string" || title.trim().length === 0) {
        sendError(res, "BAD_REQUEST", "Document title is required.", 400, {}, requestId);
        return;
      }

      const parsedVisibility =
        visibility === "PUBLIC_VERIFIABLE"
          ? DocumentVisibility.PUBLIC_VERIFIABLE
          : DocumentVisibility.PRIVATE;

      const result = await documentService.ingestDocument({
        userId: req.user!.userId,
        fileBuffer: file.buffer,
        originalFileName: file.originalname || "document.bin",
        title: title.trim(),
        description: description ? String(description) : undefined,
        visibility: parsedVisibility,
        publishTitle: publishTitle === "true" || publishTitle === true,
        publishDescription: publishDescription === "true" || publishDescription === true,
        registerOnChain: registerOnChain === "true" || registerOnChain === true,
        requestId,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      sendSuccess(res, result.document, result.isDuplicate ? 200 : 201);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/documents
 * List documents owned by authenticated user
 */
documentRouter.get(
  "/",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;

      const documents = await documentService.getUserDocuments(userId, limit, offset);
      sendSuccess(res, { documents, count: documents.length }, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/documents/:id
 * Retrieve specific document details (Uniform 404 on unauthorized)
 */
documentRouter.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const documentId = req.params.id;
      const requestId = req.requestId || "req-unknown";

      const doc = await documentService.getDocumentById(documentId, userId);
      if (!doc) {
        sendError(res, "NOT_FOUND", "Document not found.", 404, {}, requestId);
        return;
      }

      sendSuccess(res, { document: doc }, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/documents/:id/visibility
 * Toggle visibility between PRIVATE and PUBLIC_VERIFIABLE
 */
documentRouter.patch(
  "/:id/visibility",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const documentId = req.params.id;
      const requestId = req.requestId || "req-unknown";
      const { visibility, publishTitle } = req.body || {};

      if (!visibility || !["PRIVATE", "PUBLIC_VERIFIABLE"].includes(visibility)) {
        sendError(
          res,
          "BAD_REQUEST",
          "Visibility must be either 'PRIVATE' or 'PUBLIC_VERIFIABLE'.",
          400,
          {},
          requestId
        );
        return;
      }

      const updated = await documentService.updateVisibility(
        documentId,
        userId,
        visibility as DocumentVisibility,
        publishTitle,
        requestId
      );

      sendSuccess(res, { document: updated }, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/documents/:id
 * Purges file bytes and soft-deletes document
 */
documentRouter.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const documentId = req.params.id;
      const requestId = req.requestId || "req-unknown";

      await documentService.deleteDocument(documentId, userId, requestId);
      sendSuccess(res, { message: "Document successfully deleted and storage purged." }, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/documents/:id/revoke
 * Revokes document on-chain
 */
documentRouter.post(
  "/:id/revoke",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const documentId = req.params.id;
      const requestId = req.requestId || "req-unknown";
      const { reason = "Revoked by document owner" } = req.body || {};

      const updated = await documentService.revokeDocument(
        documentId,
        userId,
        String(reason),
        requestId
      );

      sendSuccess(res, { document: updated }, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/documents/:id/verify
 * Private verification: uploads candidate file to verify against on-chain hash
 */
documentRouter.post(
  "/:id/verify",
  uploadMiddleware.single("file"),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const documentId = req.params.id;
      const requestId = req.requestId || "req-unknown";
      const file = req.file;

      if (!file) {
        sendError(res, "BAD_REQUEST", "No candidate file provided for verification.", 400, {}, requestId);
        return;
      }

      const result = await documentService.verifyPrivateDocument(
        documentId,
        userId,
        file.buffer,
        requestId
      );

      sendSuccess(res, result, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/documents/:id/register-on-chain
 * Triggers manual on-chain registration / retry (Decision Q5)
 */
documentRouter.post(
  "/:id/register-on-chain",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const documentId = req.params.id;
      const requestId = req.requestId || "req-unknown";

      const doc = await documentService.registerDocumentOnChain(
        documentId,
        userId,
        requestId
      );

      sendSuccess(res, { document: doc }, 200);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/documents/:id/chain-status
 * Queries persistent TransactionOperation history and on-chain status
 */
documentRouter.get(
  "/:id/chain-status",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const documentId = req.params.id;

      const status = await documentService.getChainStatus(documentId, userId);
      sendSuccess(res, status, 200);
    } catch (err) {
      next(err);
    }
  }
);
