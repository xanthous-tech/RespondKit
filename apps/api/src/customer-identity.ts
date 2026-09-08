import { z } from "zod";

const claimsSchema = z.strictObject({
  aud: z.literal("respondkit"),
  inboxId: z.string().min(1),
  sub: z.string().min(1).max(256),
  email: z.email().max(320).optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid JWT encoding");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
}

/** Accept only short-lived HS256 assertions signed by the product backend for this inbox. */
export async function verifyCustomerIdentity(input: {
  token: string;
  inboxId: string;
  signingKeys: string | undefined;
  signingKey?: string | undefined;
  now?: number;
}) {
  try {
    const secret = z
      .string()
      .min(32)
      .parse(
        input.signingKey ??
          z.record(z.string(), z.string().min(32)).parse(JSON.parse(input.signingKeys ?? "{}"))[
            input.inboxId
          ],
      );
    const [header, payload, signature, extra] = input.token.split(".");
    if (!header || !payload || !signature || extra !== undefined) return null;
    const parsedHeader = JSON.parse(new TextDecoder().decode(decode(header))) as unknown;
    z.strictObject({ alg: z.literal("HS256"), typ: z.literal("JWT") }).parse(parsedHeader);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        decode(signature),
        new TextEncoder().encode(`${header}.${payload}`),
      ))
    )
      return null;
    const claims = claimsSchema.parse(JSON.parse(new TextDecoder().decode(decode(payload))));
    const now = input.now ?? Math.floor(Date.now() / 1000);
    if (
      claims.inboxId !== input.inboxId ||
      claims.iat > now + 30 ||
      claims.exp <= now ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 300
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}
