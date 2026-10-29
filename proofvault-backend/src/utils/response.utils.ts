import { Response } from "express";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "BLOCKCHAIN_RPC_ERROR"
  | "TRANSACTION_REVERTED"
  | "RATE_LIMITED"
  | "INTERNAL_SERVER_ERROR";

export interface ApiSuccessEnvelope<T = any> {
  success: true;
  data: T;
  error: null;
}

export interface ApiErrorEnvelope {
  success: false;
  data: null;
  error: {
    code: ApiErrorCode;
    message: string;
    details: Record<string, any>;
    requestId: string;
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200
): Response {
  const envelope: ApiSuccessEnvelope<T> = {
    success: true,
    data,
    error: null,
  };
  return res.status(statusCode).json(envelope);
}

export function sendError(
  res: Response,
  code: ApiErrorCode,
  message: string,
  statusCode = 400,
  details: Record<string, any> = {},
  requestId = "req-unassigned"
): Response {
  const envelope: ApiErrorEnvelope = {
    success: false,
    data: null,
    error: {
      code,
      message,
      details,
      requestId,
    },
  };
  return res.status(statusCode).json(envelope);
}
