import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incomingId = req.headers["x-request-id"];
  const requestId =
    typeof incomingId === "string" && incomingId.length > 0
      ? incomingId.slice(0, 64)
      : `req-${uuidv4()}`;

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}
