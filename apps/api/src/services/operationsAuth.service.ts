import {
  createHmac,
  pbkdf2Sync,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { ApiError } from "../http/apiError.js";

const TOKEN_PREFIX = "dx1";
const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const MIN_TOKEN_SECRET_LENGTH = 32;

const LoginInputSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

const TokenClaimsSchema = z.object({
  sub: z.string().min(1),
  name: z.string().min(1),
  role: z.literal("ADMIN"),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  jti: z.string().uuid(),
});

const PasswordHashSchema = z
  .string()
  .regex(/^pbkdf2\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);

export type OperationsUser = {
  username: string;
  displayName: string;
  role: "ADMIN";
};

export type OperationsAuthStatus = {
  mode: "DISABLED" | "ENABLED";
  readiness: "LOCAL_BYPASS" | "ENABLED" | "MISCONFIGURED";
};

export function getOperationsAuthStatus(): OperationsAuthStatus {
  const mode = authMode();
  if (mode === "DISABLED") {
    return { mode, readiness: "LOCAL_BYPASS" };
  }
  return {
    mode,
    readiness: hasCompleteProductionConfiguration()
      ? "ENABLED"
      : "MISCONFIGURED",
  };
}

export function assertOperationsAuthConfiguration(): void {
  if (authMode() === "DISABLED") return;
  if (!hasCompleteProductionConfiguration()) {
    throw new Error(
      "OPS_AUTH_MODE=enabled requires OPS_ADMIN_USERNAME, " +
        "OPS_ADMIN_PASSWORD_HASH, a 32+ character OPS_AUTH_TOKEN_SECRET " +
        "and OPS_CORS_ORIGINS",
    );
  }
}

export function loginOperationsUser(input: unknown): {
  token: string;
  expiresAt: string;
  user: OperationsUser;
} {
  const body = LoginInputSchema.parse(input);
  if (authMode() !== "ENABLED") {
    throw new ApiError(
      409,
      "AUTH_DISABLED",
      "当前为本地免登录模式，无需提交员工账号",
    );
  }
  assertOperationsAuthConfiguration();

  const expectedUsername = requiredEnv("OPS_ADMIN_USERNAME");
  const validUsername = constantTimeTextEqual(body.username, expectedUsername);
  const validPassword = verifyPassword(
    body.password,
    requiredEnv("OPS_ADMIN_PASSWORD_HASH"),
  );
  if (!validUsername || !validPassword) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "账号或密码错误");
  }

  const now = Math.floor(Date.now() / 1000);
  const claims = TokenClaimsSchema.parse({
    sub: expectedUsername,
    name: process.env.OPS_ADMIN_DISPLAY_NAME?.trim() || "平台管理员",
    role: "ADMIN",
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    jti: randomUUID(),
  });
  return {
    token: signClaims(claims),
    expiresAt: new Date(claims.exp * 1000).toISOString(),
    user: claimsToUser(claims),
  };
}

export function authenticateOperationsRequest(
  authorization: string | undefined,
): OperationsUser {
  if (authMode() === "DISABLED") {
    return {
      username: "local-development",
      displayName: "本地研发管理员",
      role: "ADMIN",
    };
  }
  assertOperationsAuthConfiguration();
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new ApiError(401, "AUTH_REQUIRED", "请先登录东信设备运营平台");
  }

  const claims = verifyToken(match[1]);
  return claimsToUser(claims);
}

export function getLocalOperationsSession(): {
  mode: "DISABLED";
  user: OperationsUser;
} | null {
  if (authMode() !== "DISABLED") return null;
  return {
    mode: "DISABLED",
    user: {
      username: "local-development",
      displayName: "本地研发管理员",
      role: "ADMIN",
    },
  };
}

export function getOperationsCorsOrigins(): true | string[] {
  if (authMode() === "DISABLED") return true;
  return (process.env.OPS_CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function authMode(): "DISABLED" | "ENABLED" {
  return process.env.OPS_AUTH_MODE?.trim().toLowerCase() === "enabled"
    ? "ENABLED"
    : "DISABLED";
}

function hasCompleteProductionConfiguration(): boolean {
  const username = process.env.OPS_ADMIN_USERNAME?.trim();
  const passwordHash = process.env.OPS_ADMIN_PASSWORD_HASH?.trim();
  const tokenSecret = process.env.OPS_AUTH_TOKEN_SECRET?.trim();
  const corsOrigins = getOperationsCorsOrigins();
  return Boolean(
    username &&
      passwordHash &&
      PasswordHashSchema.safeParse(passwordHash).success &&
      tokenSecret &&
      tokenSecret.length >= MIN_TOKEN_SECRET_LENGTH &&
      Array.isArray(corsOrigins) &&
      corsOrigins.length > 0,
  );
}

function signClaims(claims: z.infer<typeof TokenClaimsSchema>): string {
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = signatureFor(encoded);
  return `${TOKEN_PREFIX}.${encoded}.${signature}`;
}

function verifyToken(token: string): z.infer<typeof TokenClaimsSchema> {
  const [prefix, encoded, signature, extra] = token.split(".");
  if (prefix !== TOKEN_PREFIX || !encoded || !signature || extra) {
    throw new ApiError(401, "INVALID_SESSION", "登录状态无效，请重新登录");
  }
  const expected = signatureFor(encoded);
  if (!constantTimeTextEqual(signature, expected)) {
    throw new ApiError(401, "INVALID_SESSION", "登录状态无效，请重新登录");
  }
  try {
    const claims = TokenClaimsSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new ApiError(401, "SESSION_EXPIRED", "登录已过期，请重新登录");
    }
    return claims;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "INVALID_SESSION", "登录状态无效，请重新登录");
  }
}

function signatureFor(encodedClaims: string): string {
  return createHmac("sha256", requiredEnv("OPS_AUTH_TOKEN_SECRET"))
    .update(`${TOKEN_PREFIX}.${encodedClaims}`)
    .digest("base64url");
}

function verifyPassword(password: string, encodedHash: string): boolean {
  const parsed = PasswordHashSchema.safeParse(encodedHash);
  if (!parsed.success) return false;
  const [, iterationText, saltText, digestText] = parsed.data.split("$");
  const iterations = Number(iterationText);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    iterations > 1_000_000
  ) {
    return false;
  }
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(digestText, "base64url");
  if (salt.length < 16 || expected.length < 32) return false;
  const actual = pbkdf2Sync(password, salt, iterations, expected.length, "sha256");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function constantTimeTextEqual(actual: string, expected: string): boolean {
  const actualDigest = createHmac("sha256", "dx-constant-time-compare")
    .update(actual)
    .digest();
  const expectedDigest = createHmac("sha256", "dx-constant-time-compare")
    .update(expected)
    .digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function claimsToUser(
  claims: z.infer<typeof TokenClaimsSchema>,
): OperationsUser {
  return {
    username: claims.sub,
    displayName: claims.name,
    role: claims.role,
  };
}
