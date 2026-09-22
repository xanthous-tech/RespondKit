import { beforeAll, describe, expect, it } from "vite-plus/test";

import {
  DISCORD_PONG_RESPONSE,
  DiscordInteractionParseError,
  authorizeDiscordCommand,
  createEphemeralInteractionResponse,
  normalizeDiscordCommand,
  parseDiscordInteraction,
  verifyDiscordSignature,
} from "./interactions";

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const ids = {
  interaction: "100000000000000001",
  application: "100000000000000002",
  guild: "100000000000000003",
  thread: "100000000000000004",
  forum: "100000000000000005",
  operator: "100000000000000006",
  role: "100000000000000007",
};

function replyPayload(message = "Please reopen the app"): Record<string, unknown> {
  return {
    id: ids.interaction,
    application_id: ids.application,
    type: 2,
    token: "short-lived-token",
    guild_id: ids.guild,
    channel_id: ids.thread,
    channel: {
      id: ids.thread,
      type: 11,
      parent_id: ids.forum,
    },
    member: {
      user: { id: ids.operator },
      roles: [ids.role],
    },
    data: {
      type: 1,
      name: "reply",
      options: [{ type: 3, name: "message", value: message }],
    },
  };
}

describe("Discord signature verification", () => {
  let publicKeyHex: string;
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const keys = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    privateKey = keys.privateKey;
    publicKeyHex = bytesToHex(await crypto.subtle.exportKey("raw", keys.publicKey));
  });

  async function signedInput(rawBody: string, timestamp = "1787661000") {
    const signedBytes = new TextEncoder().encode(timestamp + rawBody);
    const signature = await crypto.subtle.sign("Ed25519", privateKey, signedBytes);
    return {
      publicKeyHex,
      signatureHex: bytesToHex(signature),
      timestamp,
      rawBody,
      nowMs: Number(timestamp) * 1_000,
    };
  }

  it("verifies the exact timestamp plus unmodified raw body", async () => {
    const body = JSON.stringify(replyPayload());
    await expect(verifyDiscordSignature(await signedInput(body))).resolves.toEqual({
      ok: true,
      timestampMs: 1_787_661_000_000,
    });
  });

  it("rejects a semantically equivalent but byte-different body", async () => {
    const body = JSON.stringify(replyPayload());
    const signed = await signedInput(body);
    await expect(
      verifyDiscordSignature({ ...signed, rawBody: JSON.stringify(replyPayload(), undefined, 2) }),
    ).resolves.toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects malformed signatures and stale timestamps", async () => {
    const body = JSON.stringify(replyPayload());
    const signed = await signedInput(body);
    await expect(verifyDiscordSignature({ ...signed, signatureHex: "not-hex" })).resolves.toEqual({
      ok: false,
      reason: "invalid_signature",
    });
    await expect(
      verifyDiscordSignature({ ...signed, nowMs: signed.nowMs + 300_001 }),
    ).resolves.toEqual({ ok: false, reason: "stale_timestamp" });
  });
});

describe("Discord interaction parsing and authorization", () => {
  it("parses, authorizes, and normalizes /reply without retaining its token", () => {
    const parsed = parseDiscordInteraction(JSON.stringify(replyPayload()));
    expect(parsed).toMatchObject({
      kind: "command",
      command: "reply",
      message: "Please reopen the app",
      forumChannelId: ids.forum,
      operatorRoleIds: [ids.role],
    });
    if (parsed.kind !== "command") {
      throw new Error("Expected command interaction");
    }

    expect(
      authorizeDiscordCommand(parsed, {
        applicationId: ids.application,
        guildId: ids.guild,
        forumChannelId: ids.forum,
        discordThreadId: ids.thread,
        operatorUserIds: [],
        operatorRoleIds: [ids.role],
      }),
    ).toEqual({ ok: true, matchedBy: "role" });

    const normalized = normalizeDiscordCommand(parsed);
    expect(normalized).toEqual({
      command: "reply",
      interactionId: ids.interaction,
      applicationId: ids.application,
      guildId: ids.guild,
      discordThreadId: ids.thread,
      operatorUserId: ids.operator,
      operatorRoleIds: [ids.role],
      message: "Please reopen the app",
      translate: "off",
    });
    expect(normalized).not.toHaveProperty("token");
  });

  it("parses message actions, optional translation arguments, and approval buttons", () => {
    const base = replyPayload();
    expect(
      parseDiscordInteraction(
        JSON.stringify({
          ...base,
          data: { type: 3, name: "Translate to English", target_id: "12345" },
        }),
      ),
    ).toMatchObject({ command: "translate", targetMessageId: "12345", targetLanguage: "en" });
    expect(
      parseDiscordInteraction(JSON.stringify({ ...base, data: { type: 1, name: "translate" } })),
    ).toMatchObject({ command: "translate", targetLanguage: "en" });
    expect(
      parseDiscordInteraction(
        JSON.stringify({
          ...base,
          data: {
            type: 1,
            name: "reply",
            options: [
              { type: 3, name: "message", value: "Hello" },
              { type: 3, name: "translate", value: "hi" },
            ],
          },
        }),
      ),
    ).toMatchObject({ command: "reply", translate: "hi" });
    expect(
      parseDiscordInteraction(
        JSON.stringify({ ...base, type: 3, data: { custom_id: "confirm-translation:12345:2" } }),
      ),
    ).toMatchObject({ command: "confirm_translation", reference: "12345", generation: 2 });
    expect(() =>
      parseDiscordInteraction(
        JSON.stringify({
          ...base,
          data: {
            type: 1,
            name: "translate",
            options: [{ type: 3, name: "to", value: "en; DROP TABLE message" }],
          },
        }),
      ),
    ).toThrow(DiscordInteractionParseError);
    expect(() =>
      parseDiscordInteraction(
        JSON.stringify({ ...base, data: { type: 3, name: "reply", target_id: "12345" } }),
      ),
    ).toThrow(DiscordInteractionParseError);
  });

  it("denies commands from the wrong forum even when the operator is allowed", () => {
    const parsed = parseDiscordInteraction(JSON.stringify(replyPayload()));
    if (parsed.kind !== "command") {
      throw new Error("Expected command interaction");
    }
    expect(
      authorizeDiscordCommand(parsed, {
        applicationId: ids.application,
        guildId: ids.guild,
        forumChannelId: "999999999999999999",
        discordThreadId: ids.thread,
        operatorUserIds: [ids.operator],
        operatorRoleIds: [],
      }),
    ).toEqual({ ok: false, reason: "forum_mismatch" });
  });

  it("strictly validates command options", () => {
    const payload = replyPayload();
    const data = payload.data as Record<string, unknown>;
    data.options = [
      { type: 3, name: "message", value: "hello" },
      { type: 3, name: "unexpected", value: "ignored?" },
    ];
    expect(() => parseDiscordInteraction(JSON.stringify(payload))).toThrowError(
      DiscordInteractionParseError,
    );
  });

  it("rejects a whitespace-only reply while preserving nonblank operator text", () => {
    expect(() => parseDiscordInteraction(JSON.stringify(replyPayload(" \n\t ")))).toThrowError(
      DiscordInteractionParseError,
    );

    const parsed = parseDiscordInteraction(JSON.stringify(replyPayload("  preserve spacing  ")));
    expect(parsed).toMatchObject({
      kind: "command",
      command: "reply",
      message: "  preserve spacing  ",
    });
  });

  it("parses signed PING-shaped payloads and exposes safe response helpers", () => {
    const ping = parseDiscordInteraction(
      JSON.stringify({
        id: ids.interaction,
        application_id: ids.application,
        type: 1,
        token: "ping-token",
      }),
    );
    expect(ping.kind).toBe("ping");
    expect(DISCORD_PONG_RESPONSE).toEqual({ type: 1 });
    expect(createEphemeralInteractionResponse("Queued")).toEqual({
      type: 4,
      data: {
        content: "Queued",
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    });
  });
});

describe("activity command options", () => {
  function parse(options: unknown[] = []) {
    return parseDiscordInteraction(
      JSON.stringify({ ...replyPayload(), data: { type: 1, name: "activity", options } }),
    );
  }
  it("defaults to the latest 20 events and supports native integer options", () => {
    expect(parse()).toMatchObject({
      command: "activity",
      count: 20,
      minutes: 10080,
      activityKind: "all",
      until: "now",
    });
    expect(parse([{ name: "minutes", type: 4, value: 30 }])).toMatchObject({
      count: 100,
      minutes: 30,
    });
    const parsed = parse([
      { name: "count", type: 4, value: 50 },
      { name: "kind", type: 3, value: "pageviews" },
      { name: "until", type: 3, value: "last_message" },
    ]);
    expect(parsed).toMatchObject({ count: 50, activityKind: "pageviews", until: "last_message" });
    if (parsed.kind === "command")
      expect(normalizeDiscordCommand(parsed)).toMatchObject({ command: "activity", count: 50 });
  });
  it.each([
    [{ name: "count", type: 4, value: 0 }],
    [{ name: "count", type: 4, value: 101 }],
    [{ name: "count", type: 4, value: 1.5 }],
    [{ name: "count", type: 3, value: "20" }],
    [{ name: "minutes", type: 4, value: 10081 }],
    [{ name: "kind", type: 3, value: "raw" }],
    [{ name: "until", type: 3, value: "yesterday" }],
    [{ name: "project", type: 3, value: "other" }],
  ])("rejects invalid or extra activity options: %j", (option) => {
    expect(() => parse([option])).toThrow(DiscordInteractionParseError);
  });
});
