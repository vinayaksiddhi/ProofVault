import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { sendError, ApiErrorCode } from "../utils/response.utils";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = req.requestId || "req-unknown";

  // 1. Multer specific errors
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      sendError(
        res,
        "PAYLOAD_TOO_LARGE",
        "File size exceeds the allowed limit of 25 MiB.",
        413,
        { multerCode: err.code },
        requestId
      );
      return;
    }

    sendError(
      res,
      "BAD_REQUEST",
      `File upload error: ${err.message}`,
      400,
      { multerCode: err.code },
      requestId
    );
    return;
  }

  // 2. Custom handled errors { statusCode, code, message, details }
  if (err.statusCode && err.code) {
    sendError(
      res,
      err.code as ApiErrorCode,
      err.message || "An error occurred.",
      err.statusCode,
      err.details || {},
      requestId
    );
    return;
  }

  // 3. Syntax error (e.g. malformed JSON body)
  if (err instanceof SyntaxError && "body" in err) {
    sendError(
      res,
      "BAD_REQUEST",
      "Malformed JSON payload in request body.",
      400,
      {},
      requestId
    );
    return;
  }

  // 4. Default unhandled internal server error
  console.error(`[UnhandledError] [${requestId}]`, err);
  sendError(
    res,
    "INTERNAL_SERVER_ERROR",
    "An unexpected internal server error occurred.",
    500,
    {},
    requestId
  );
}
