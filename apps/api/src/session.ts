import {
  ClientSessionIdSchema,
  InboxIdSchema,
  SessionTokenSchema,
  VisitorIdSchema,
  WorkspaceIdSchema,
  type ClientSessionId,
  type InboxId,
  type SessionToken,
  type VisitorId,
  type WorkspaceId,
} from "@respondkit/protocol";
import { z } from "zod";

const SESSION_TOKEN_VERSION = "v1";
const DEFAULT_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

const sessionClaimsSchema = z.strictObject({
  version: z.literal(1),
  sessionId: ClientSessionIdSchema,
  workspaceId: WorkspaceIdSchema,
  inboxId: InboxIdSchema,
  visitorId: VisitorIdSchema,
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type AnonymousSessionClaims = z.infer<typeof sessionClaimsSchema>;

export interface CreateAnonymousSessionInput {
  readonly signingKey: string;
  readonly sessionId: ClientSessionId;
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly visitorId: VisitorId;
  readonly now?: Date;
  readonly lifetimeSeconds?: number;
}

export interface AnonymousSession {
  readonly claims: AnonymousSessionClaims;
  readonly token: SessionToken;
}

function requireSigningKey(value: string): string {
  if (value.length < 16) {
    throw new TypeError("SESSION_SIGNING_KEY must contain at least 16 characters");
  }
  return value;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

async function importSigningKey(signingKey: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requireSigningKey(signingKey)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

async function sign(signingKey: string, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importSigningKey(signingKey, "sign"),
    new TextEncoder().encode(`${SESSION_TOKEN_VERSION}.${payload}`),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

export async function createAnonymousSession(
  input: CreateAnonymousSessionInput,
): Promise<AnonymousSession> {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const lifetimeSeconds = input.lifetimeSeconds ?? DEFAULT_SESSION_LIFETIME_SECONDS;
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds < 60) {
    throw new RangeError("Anonymous session lifetime must be at least 60 seconds");
  }

  const claims = sessionClaimsSchema.parse({
    version: 1,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    inboxId: input.inboxId,
    visitorId: input.visitorId,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + lifetimeSeconds,
  });
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await sign(input.signingKey, payload);
  return {
    claims,
    token: SessionTokenSchema.parse(`${SESSION_TOKEN_VERSION}.${payload}.${signature}`),
  };
}

export async function verifyAnonymousSession(input: {
  readonly signingKey: string;
  readonly token: string;
  readonly now?: Date;
}): Promise<AnonymousSessionClaims | null> {
  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_VERSION) return null;
  const payload = parts[1];
  const signature = parts[2];
  if (payload === undefined || signature === undefined) return null;
  const signatureBytes = decodeBase64Url(signature);
  const payloadBytes = decodeBase64Url(payload);
  if (signatureBytes === undefined || payloadBytes === undefined) return null;

  let verified: boolean;
  try {
    verified = await crypto.subtle.verify(
      "HMAC",
      await importSigningKey(input.signingKey, "verify"),
      signatureBytes,
      new TextEncoder().encode(`${SESSION_TOKEN_VERSION}.${payload}`),
    );
  } catch {
    return null;
  }
  if (!verified) return null;

  try {
    const claims = sessionClaimsSchema.parse(
      JSON.parse(new TextDecoder().decode(payloadBytes)) as unknown,
    );
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    return claims.issuedAt <= nowSeconds + 60 && claims.expiresAt > nowSeconds ? claims : null;
  } catch {
    return null;
  }
}

export function readBearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
  return match?.[1] ?? null;
}
