import { Request, Response, NextFunction } from "express";
import { authService, UserTokenPayload } from "../services/auth.service";
import { sendError } from "../utils/response.utils";

declare global {
  namespace Express {
    interface Request {
      user?: UserTokenPayload;
    }
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers["authorization"];
  const requestId = req.requestId || "req-unknown";

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendError(
      res,
      "UNAUTHORIZED",
      "Authentication required. Missing or malformed Bearer token in Authorization header.",
      401,
      {},
      requestId
    );
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    sendError(
      res,
      "UNAUTHORIZED",
      "Bearer token is empty.",
      401,
      {},
      requestId
    );
    return;
  }

  try {
    const payload = authService.verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err: any) {
    const message =
      err.name === "TokenExpiredError"
        ? "Access token has expired."
        : "Invalid access token.";

    sendError(
      res,
      "UNAUTHORIZED",
      message,
      401,
      { errorType: err.name },
      requestId
    );
  }
}
