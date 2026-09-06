export const IDENTITY_TEST_KEY = "test-identity-key-at-least-32-characters";

export async function identityToken(
  claims: Record<string, unknown> = {},
  secret = IDENTITY_TEST_KEY,
  header = { alg: "HS256", typ: "JWT" },
) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode(header)}.${encode({ aud: "respondkit", inboxId: "inbox_public_test", sub: "alice", iat: now, exp: now + 300, ...claims })}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  const signature = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `${payload}.${signature}`;
}
