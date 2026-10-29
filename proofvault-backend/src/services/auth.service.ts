import jwt from "jsonwebtoken";
import { prisma } from "../db/client";
import { config } from "../config";
import { hashPassword, comparePassword } from "../utils/crypto.utils";
import { auditService } from "./audit.service";
import { AuditEventType, Role, UserStatus } from "@prisma/client";

export interface UserTokenPayload {
  userId: string;
  email: string;
  role: Role;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
}

export interface UserResponseDto {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class AuthService {
  /**
   * Generates JWT access and refresh tokens.
   */
  generateTokens(payload: UserTokenPayload): AuthTokens {
    const accessToken = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as any,
    });
    const refreshToken = jwt.sign(payload, config.refreshTokenSecret, {
      expiresIn: config.refreshTokenExpiresIn as any,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: config.jwtExpiresIn,
    };
  }

  /**
   * Verifies and decodes an access token.
   */
  verifyAccessToken(token: string): UserTokenPayload {
    return jwt.verify(token, config.jwtSecret) as UserTokenPayload;
  }

  /**
   * Validates password strength: >=8 chars, 1 uppercase, 1 number, 1 symbol.
   */
  validatePasswordComplexity(password: string): { valid: boolean; reason?: string } {
    if (!password || password.length < 8) {
      return { valid: false, reason: "Password must be at least 8 characters long." };
    }
    if (!/[A-Z]/.test(password)) {
      return { valid: false, reason: "Password must contain at least one uppercase letter." };
    }
    if (!/[0-9]/.test(password)) {
      return { valid: false, reason: "Password must contain at least one numeric digit." };
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return { valid: false, reason: "Password must contain at least one special character or symbol." };
    }
    return { valid: true };
  }

  /**
   * Registers a new user account.
   */
  async register(
    email: string,
    password: string,
    requestId: string,
    ip?: string,
    userAgent?: string
  ): Promise<{ user: UserResponseDto; tokens: AuthTokens }> {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Password complexity check
    const complexity = this.validatePasswordComplexity(password);
    if (!complexity.valid) {
      throw {
        statusCode: 400,
        code: "BAD_REQUEST",
        message: complexity.reason,
      };
    }

    // 2. Email duplication check
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      throw {
        statusCode: 409,
        code: "CONFLICT",
        message: "An account with this email address already exists.",
      };
    }

    // 3. Hash password & persist
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: Role.USER,
        status: UserStatus.ACTIVE,
      },
    });

    // 4. Audit log
    await auditService.record({
      actorUserId: user.id,
      eventType: AuditEventType.USER_REGISTERED,
      result: "SUCCESS",
      requestId,
      ip,
      userAgent,
      metadata: { email: user.email },
    });

    // 5. Generate tokens
    const tokens = this.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      tokens,
    };
  }

  /**
   * Authenticates user with email and password.
   */
  async login(
    email: string,
    password: string,
    requestId: string,
    ip?: string,
    userAgent?: string
  ): Promise<{ user: UserResponseDto; tokens: AuthTokens }> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      await auditService.record({
        actorUserId: null,
        eventType: AuditEventType.USER_LOGIN,
        result: "FAILURE",
        requestId,
        ip,
        userAgent,
        metadata: { email: normalizedEmail, reason: "USER_NOT_FOUND" },
      });

      throw {
        statusCode: 401,
        code: "UNAUTHORIZED",
        message: "Invalid email or password.",
      };
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
      await auditService.record({
        actorUserId: user.id,
        eventType: AuditEventType.USER_LOGIN,
        result: "FAILURE",
        requestId,
        ip,
        userAgent,
        metadata: { reason: "PASSWORD_MISMATCH" },
      });

      throw {
        statusCode: 401,
        code: "UNAUTHORIZED",
        message: "Invalid email or password.",
      };
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw {
        statusCode: 403,
        code: "FORBIDDEN",
        message: `Account is not active (Status: ${user.status}).`,
      };
    }

    await auditService.record({
      actorUserId: user.id,
      eventType: AuditEventType.USER_LOGIN,
      result: "SUCCESS",
      requestId,
      ip,
      userAgent,
    });

    const tokens = this.generateTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      tokens,
    };
  }

  /**
   * Retrieves sanitized user profile by userId.
   */
  async getMe(userId: string): Promise<UserResponseDto> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw {
        statusCode: 404,
        code: "NOT_FOUND",
        message: "User profile not found.",
      };
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

export const authService = new AuthService();
