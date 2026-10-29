import { Router, Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service";
import { requireAuth } from "../middleware/auth.middleware";
import { sendSuccess, sendError } from "../utils/response.utils";

export const authRouter = Router();

authRouter.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body || {};
      const requestId = req.requestId || "req-unknown";

      if (!email || !password) {
        sendError(res, "BAD_REQUEST", "Email and password are required.", 400, {}, requestId);
        return;
      }

      const result = await authService.register(
        email,
        password,
        requestId,
        req.ip,
        req.headers["user-agent"]
      );

      sendSuccess(res, result, 201);
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body || {};
      const requestId = req.requestId || "req-unknown";

      if (!email || !password) {
        sendError(res, "BAD_REQUEST", "Email and password are required.", 400, {}, requestId);
        return;
      }

      const result = await authService.login(
        email,
        password,
        requestId,
        req.ip,
        req.headers["user-agent"]
      );

      sendSuccess(res, result, 200);
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  "/logout",
  requireAuth,
  (req: Request, res: Response): void => {
    sendSuccess(res, { message: "Successfully logged out." }, 200);
  }
);

authRouter.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const user = await authService.getMe(userId);
      sendSuccess(res, { user }, 200);
    } catch (err) {
      next(err);
    }
  }
);
