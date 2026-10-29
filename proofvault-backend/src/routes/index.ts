import { Router, Request, Response } from "express";
import { authRouter } from "./auth.routes";
import { documentRouter } from "./document.routes";
import { publicRouter } from "./public.routes";
import { prisma } from "../db/client";
import { blockchainService } from "../services/blockchain.service";
import { sendSuccess } from "../utils/response.utils";

export const apiRouter = Router();

apiRouter.get("/health", async (req: Request, res: Response): Promise<void> => {
  let dbHealthy = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbHealthy = true;
  } catch {
    dbHealthy = false;
  }

  sendSuccess(
    res,
    {
      status: "healthy",
      service: "proofvault-backend",
      timestamp: new Date(),
      database: dbHealthy ? "connected" : "disconnected",
      blockchain: {
        chainId: blockchainService.getChainId(),
        configured: blockchainService.isConfigured(),
      },
    },
    200
  );
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/documents", documentRouter);
apiRouter.use("/public", publicRouter);
