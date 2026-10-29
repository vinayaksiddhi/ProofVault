import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { requestIdMiddleware } from "./middleware/request-id.middleware";
import { errorHandler } from "./middleware/error.middleware";
import { apiRouter } from "./routes";
import { sendError } from "./utils/response.utils";

export const app: Express = express();

// Security headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  })
);

// Request tracking
app.use(requestIdMiddleware);

// Body parsing (standard JSON/URL-encoded; multipart handled by multer in routes)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// API versioning
app.use("/api/v1", apiRouter);

// 404 Catch-all for undefined routes
app.use((req: Request, res: Response): void => {
  const requestId = req.requestId || "req-unknown";
  sendError(
    res,
    "NOT_FOUND",
    `Route ${req.method} ${req.originalUrl} not found.`,
    404,
    {},
    requestId
  );
});

// Centralized error handler
app.use(errorHandler);

export default app;
