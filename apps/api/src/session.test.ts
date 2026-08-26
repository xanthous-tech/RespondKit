import { describe, expect, it } from "vite-plus/test";

import { createAnonymousSession, readBearerToken, verifyAnonymousSession } from "./session";

const signingKey = "test-session-signing-key-that-is-separate";
const now = new Date("2026-08-25T12:00:00.000Z");

describe("anonymous session tokens", () => {
  it("round trips scoped claims without server-side session state", async () => {
    const session = await createAnonymousSession({
      signingKey,
      sessionId: "session_1",
      workspaceId: "workspace_1",
      inboxId: "inbox_1",
      visitorId: "visitor_1",
      now,
      lifetimeSeconds: 300,
    });

    await expect(
      verifyAnonymousSession({ signingKey, token: session.token, now }),
    ).resolves.toEqual(session.claims);
    expect(readBearerToken(`Bearer ${session.token}`)).toBe(session.token);
  });

  it("rejects tampering, expiration, and non-Bearer authorization", async () => {
    const session = await createAnonymousSession({
      signingKey,
      sessionId: "session_1",
      workspaceId: "workspace_1",
      inboxId: "inbox_1",
      visitorId: "visitor_1",
      now,
      lifetimeSeconds: 60,
    });
    const tampered = `${session.token.slice(0, -1)}${session.token.endsWith("a") ? "b" : "a"}`;

    await expect(verifyAnonymousSession({ signingKey, token: tampered, now })).resolves.toBeNull();
    await expect(
      verifyAnonymousSession({
        signingKey,
        token: session.token,
        now: new Date(now.getTime() + 60_000),
      }),
    ).resolves.toBeNull();
    expect(readBearerToken(`Basic ${session.token}`)).toBeNull();
  });
});
