import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "transcripter_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

type SessionPayload = {
  email: string;
  issuedAt: number;
  expiresAt: number;
};

function sessionSecret() {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "local-development-session-secret-change-me";
  return null;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(input: string, secret: string) {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function createSessionToken(email: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is required in production.");
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { email: normalizeEmail(email), issuedAt: now, expiresAt: now + SESSION_TTL_SECONDS };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const [encoded, received] = token.split(".");
  if (!encoded || !received) return null;
  const expected = signature(encoded, secret);
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(decode(encoded)) as SessionPayload;
    if (!payload.email || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getSession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export function sessionCookieOptions(request?: Request) {
  const forwardedProtocol = request?.headers.get("x-forwarded-proto");
  const isHttps = forwardedProtocol === "https" || request?.url.startsWith("https://");
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" ? Boolean(isHttps) : false,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function clearCookieOptions(request?: Request) {
  return { ...sessionCookieOptions(request), maxAge: 0 };
}

export function authConfiguration() {
  return {
    email: normalizeEmail(process.env.AUTH_EMAIL || (process.env.NODE_ENV === "production" ? "" : "editor@local.test")),
    password: process.env.AUTH_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "local-preview-only"),
    passwordHash: process.env.AUTH_PASSWORD_HASH || "",
  };
}
