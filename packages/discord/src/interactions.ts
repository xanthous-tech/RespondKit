export const DiscordInteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
} as const;

export const DiscordInteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
} as const;

export const DiscordMessageFlag = {
  Ephemeral: 1 << 6,
} as const;

export const DiscordChannelType = {
  GuildPublicThread: 11,
} as const;

const DEFAULT_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1_000;
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const SNOWFLAKE_PATTERN = /^\d{1,32}$/;

export type DiscordSignatureFailureReason =
  | "invalid_public_key"
  | "invalid_signature"
  | "invalid_timestamp"
  | "stale_timestamp";

export type DiscordSignatureVerificationResult =
  | { readonly ok: true; readonly timestampMs: number }
  | { readonly ok: false; readonly reason: DiscordSignatureFailureReason };

export interface VerifyDiscordSignatureInput {
  readonly publicKeyHex: string;
  readonly signatureHex: string;
  readonly timestamp: string;
  readonly rawBody: string;
  readonly nowMs?: number;
  readonly toleranceMs?: number;
  readonly crypto?: Crypto;
}

function decodeHex(value: string, expectedBytes: number): Uint8Array<ArrayBuffer> | undefined {
  if (value.length !== expectedBytes * 2 || !/^[0-9a-f]+$/i.test(value)) {
    return undefined;
  }

  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    bytes[index] = byte;
  }
  return bytes;
}

export async function verifyDiscordSignature(
  input: VerifyDiscordSignatureInput,
): Promise<DiscordSignatureVerificationResult> {
  const publicKey = decodeHex(input.publicKeyHex, ED25519_PUBLIC_KEY_BYTES);
  if (publicKey === undefined) {
    return { ok: false, reason: "invalid_public_key" };
  }

  const signature = decodeHex(input.signatureHex, ED25519_SIGNATURE_BYTES);
  if (signature === undefined) {
    return { ok: false, reason: "invalid_signature" };
  }

  if (!/^\d+$/.test(input.timestamp)) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  const timestampMs = Number(input.timestamp) * 1_000;
  if (!Number.isSafeInteger(timestampMs)) {
    return { ok: false, reason: "invalid_timestamp" };
  }

  const toleranceMs = input.toleranceMs ?? DEFAULT_SIGNATURE_TOLERANCE_MS;
  const nowMs = input.nowMs ?? Date.now();
  if (
    !Number.isFinite(toleranceMs) ||
    !Number.isFinite(nowMs) ||
    toleranceMs < 0 ||
    Math.abs(nowMs - timestampMs) > toleranceMs
  ) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const cryptoApi = input.crypto ?? globalThis.crypto;
  try {
    const key = await cryptoApi.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, [
      "verify",
    ]);
    const message = new TextEncoder().encode(input.timestamp + input.rawBody);
    const verified = await cryptoApi.subtle.verify("Ed25519", key, signature, message);
    return verified ? { ok: true, timestampMs } : { ok: false, reason: "invalid_signature" };
  } catch {
    return { ok: false, reason: "invalid_public_key" };
  }
}

interface ParsedDiscordInteractionBase {
  readonly interactionId: string;
  readonly applicationId: string;
  readonly token: string;
}

export interface ParsedDiscordPingInteraction extends ParsedDiscordInteractionBase {
  readonly kind: "ping";
}

interface ParsedDiscordCommandBase extends ParsedDiscordInteractionBase {
  readonly kind: "command";
  readonly guildId: string;
  readonly discordThreadId: string;
  readonly threadType: number;
  readonly forumChannelId: string | undefined;
  readonly operatorUserId: string;
  readonly operatorRoleIds: readonly string[];
}

export interface ParsedDiscordReplyInteraction extends ParsedDiscordCommandBase {
  readonly command: "reply";
  readonly message: string;
  readonly translate?: string;
}

export interface ParsedDiscordStatusInteraction extends ParsedDiscordCommandBase {
  readonly command: "status";
  readonly reference: string;
}

export interface ParsedDiscordRetryInteraction extends ParsedDiscordCommandBase {
  readonly command: "retry";
  readonly reference: string;
  readonly message: string;
}

export interface ParsedDiscordTranslateInteraction extends ParsedDiscordCommandBase {
  readonly command: "translate";
  readonly targetLanguage: string;
  readonly targetMessageId?: string;
  readonly messageLink?: string;
}

export interface ParsedDiscordActivityInteraction extends ParsedDiscordCommandBase {
  readonly command: "activity";
  readonly count: number;
  readonly minutes: number;
  readonly activityKind: "all" | "pageviews" | "events";
  readonly until: "now" | "last_message";
}

export interface ParsedDiscordConfirmInteraction extends ParsedDiscordCommandBase {
  readonly command: "confirm_translation";
  readonly reference: string;
  readonly generation: number;
}

export type ParsedDiscordCommandInteraction =
  | ParsedDiscordActivityInteraction
  | ParsedDiscordTranslateInteraction
  | ParsedDiscordConfirmInteraction
  | ParsedDiscordReplyInteraction
  | ParsedDiscordRetryInteraction
  | ParsedDiscordStatusInteraction;

export type ParsedDiscordInteraction =
  | ParsedDiscordCommandInteraction
  | ParsedDiscordPingInteraction;

export class DiscordInteractionParseError extends Error {
  readonly code:
    | "invalid_json"
    | "invalid_payload"
    | "unsupported_command"
    | "unsupported_interaction";

  constructor(code: DiscordInteractionParseError["code"], message: string) {
    super(message);
    this.name = "DiscordInteractionParseError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, description = key): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      `Discord interaction ${description} must be a non-empty string`,
    );
  }
  return value;
}

function requiredSnowflake(
  record: Record<string, unknown>,
  key: string,
  description = key,
): string {
  const value = requiredString(record, key, description);
  if (!SNOWFLAKE_PATTERN.test(value)) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      `Discord interaction ${description} must be a snowflake`,
    );
  }
  return value;
}

function parseOptions(
  data: Record<string, unknown>,
): ReadonlyMap<string, { readonly type: number; readonly value: string | number }> {
  if (data.options === undefined) return new Map();
  if (!Array.isArray(data.options)) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      "Discord command options must be an array",
    );
  }

  const parsed = new Map<string, { readonly type: number; readonly value: string | number }>();
  for (const rawOption of data.options) {
    if (!isRecord(rawOption)) {
      throw new DiscordInteractionParseError("invalid_payload", "Invalid Discord command option");
    }
    const name = requiredString(rawOption, "name", "option name");
    if (parsed.has(name)) {
      throw new DiscordInteractionParseError(
        "invalid_payload",
        `Duplicate Discord command option: ${name}`,
      );
    }
    if (
      !(
        (rawOption.type === 3 && typeof rawOption.value === "string") ||
        (rawOption.type === 4 &&
          typeof rawOption.value === "number" &&
          Number.isSafeInteger(rawOption.value))
      )
    ) {
      throw new DiscordInteractionParseError(
        "invalid_payload",
        `Discord command option ${name} must be a string or integer option`,
      );
    }
    parsed.set(name, { type: rawOption.type, value: rawOption.value });
  }
  return parsed;
}

function requireExactOptions(
  options: ReadonlyMap<string, { readonly type: number; readonly value: string | number }>,
  names: readonly string[],
): void {
  if (options.size !== names.length || names.some((name) => !options.has(name))) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      `Expected Discord command options: ${names.join(", ")}`,
    );
  }
}

function optionValue(
  options: ReadonlyMap<string, { readonly type: number; readonly value: string | number }>,
  name: string,
  maximumLength: number,
): string {
  const value = options.get(name)?.value;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      `Discord command option ${name} must contain 1-${maximumLength} characters`,
    );
  }
  return value;
}

function parseCommandInteraction(
  payload: Record<string, unknown>,
  base: ParsedDiscordInteractionBase,
): ParsedDiscordCommandInteraction {
  const data = payload.data;
  const member = payload.member;
  const channel = payload.channel;
  if (!isRecord(data) || !isRecord(member) || !isRecord(channel)) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      "Discord command requires data, member, and channel objects",
    );
  }
  if (payload.type !== 3 && data.type !== 1 && data.type !== 3) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      "Discord interaction is not a chat input command",
    );
  }

  const user = member.user;
  if (!isRecord(user) || !Array.isArray(member.roles)) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      "Discord guild command requires a member user and roles",
    );
  }
  const operatorRoleIds = member.roles.map((role) => {
    if (typeof role !== "string" || !SNOWFLAKE_PATTERN.test(role)) {
      throw new DiscordInteractionParseError(
        "invalid_payload",
        "Discord member roles must be snowflakes",
      );
    }
    return role;
  });

  const commandName =
    payload.type === 3 ? "confirm_translation" : requiredString(data, "name", "command name");
  const command = commandName === "Translate to English" ? "translate" : commandName;
  if (
    !["reply", "retry", "status", "translate", "confirm_translation", "activity"].includes(command)
  ) {
    throw new DiscordInteractionParseError("unsupported_command", "Unsupported Discord command");
  }
  if ((commandName === "Translate to English") !== (data.type === 3) && payload.type !== 3) {
    throw new DiscordInteractionParseError("invalid_payload", "Invalid command type");
  }
  const options = parseOptions(data);
  const threadType = channel.type;
  if (typeof threadType !== "number") {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      "Discord interaction channel type must be a number",
    );
  }
  const commandBase = {
    ...base,
    kind: "command" as const,
    guildId: requiredSnowflake(payload, "guild_id", "guild ID"),
    discordThreadId: requiredSnowflake(payload, "channel_id", "channel ID"),
    threadType,
    forumChannelId:
      typeof channel.parent_id === "string" && SNOWFLAKE_PATTERN.test(channel.parent_id)
        ? channel.parent_id
        : undefined,
    operatorUserId: requiredSnowflake(user, "id", "operator user ID"),
    operatorRoleIds,
  };
  if (command === "activity") {
    requireAllowedOptions(options, [], ["count", "minutes", "kind", "until"]);
    const integer = (name: string, fallback: number, max: number) => {
      const option = options.get(name);
      if (option === undefined) return fallback;
      if (
        option.type !== 4 ||
        typeof option.value !== "number" ||
        option.value < 1 ||
        option.value > max
      )
        throw new DiscordInteractionParseError(
          "invalid_payload",
          `${name} must be an integer from 1 to ${max}.`,
        );
      return option.value;
    };
    const activityKind = options.has("kind") ? optionValue(options, "kind", 9) : "all";
    const until = options.has("until") ? optionValue(options, "until", 12) : "now";
    if (activityKind !== "all" && activityKind !== "pageviews" && activityKind !== "events")
      throw new DiscordInteractionParseError(
        "invalid_payload",
        "kind must be all, pageviews, or events.",
      );
    if (until !== "now" && until !== "last_message")
      throw new DiscordInteractionParseError(
        "invalid_payload",
        "until must be now or last_message.",
      );
    return {
      ...commandBase,
      command,
      count: integer("count", options.has("minutes") ? 100 : 20, 100),
      minutes: integer("minutes", 10080, 10080),
      activityKind,
      until,
    };
  }
  if (command === "confirm_translation") {
    const match = /^confirm-translation:(\d{1,32}):(\d{1,9})$/.exec(
      requiredString(data, "custom_id"),
    );
    if (payload.type !== 3 || match === null)
      throw new DiscordInteractionParseError("invalid_payload", "Invalid confirmation");
    return { ...commandBase, command, reference: match[1]!, generation: Number(match[2]) };
  }
  if (command === "translate") {
    if (commandName === "Translate to English") {
      return {
        ...commandBase,
        command,
        targetLanguage: "en",
        targetMessageId: requiredSnowflake(data, "target_id"),
      };
    }
    requireAllowedOptions(options, [], ["message", "to"]);
    return {
      ...commandBase,
      command,
      targetLanguage: normalizeTranslationLanguage(
        options.has("to") ? optionValue(options, "to", 35) : "en",
      ),
      ...(options.has("message") ? { messageLink: optionValue(options, "message", 200) } : {}),
    };
  }
  if (command === "reply") {
    requireAllowedOptions(options, ["message"], ["translate"]);
    return {
      ...commandBase,
      command,
      message: optionValue(options, "message", 6_000),
      translate: normalizeReplyTranslation(
        options.has("translate") ? optionValue(options, "translate", 35) : "off",
      ),
    };
  }
  if (command === "status") {
    requireExactOptions(options, ["reference"]);
    const reference = optionValue(options, "reference", 32);
    if (!SNOWFLAKE_PATTERN.test(reference)) {
      throw new DiscordInteractionParseError(
        "invalid_payload",
        "Discord status reference must be an interaction snowflake",
      );
    }
    return { ...commandBase, command, reference };
  }

  requireExactOptions(options, ["reference", "message"]);
  const reference = optionValue(options, "reference", 32);
  if (!SNOWFLAKE_PATTERN.test(reference)) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      "Discord retry reference must be an interaction snowflake",
    );
  }
  return {
    ...commandBase,
    command: "retry",
    reference,
    message: optionValue(options, "message", 6_000),
  };
}

export function parseDiscordInteraction(rawBody: string): ParsedDiscordInteraction {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new DiscordInteractionParseError("invalid_json", "Discord interaction is not JSON");
  }

  if (!isRecord(payload)) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      "Discord interaction must be an object",
    );
  }

  const base = {
    interactionId: requiredSnowflake(payload, "id", "interaction ID"),
    applicationId: requiredSnowflake(payload, "application_id", "application ID"),
    token: requiredString(payload, "token", "token"),
  };
  if (payload.type === DiscordInteractionType.Ping) {
    return { ...base, kind: "ping" };
  }
  if (
    payload.type === DiscordInteractionType.ApplicationCommand ||
    payload.type === DiscordInteractionType.MessageComponent
  ) {
    return parseCommandInteraction(payload, base);
  }
  throw new DiscordInteractionParseError(
    "unsupported_interaction",
    `Unsupported Discord interaction type: ${String(payload.type)}`,
  );
}

export type DiscordAuthorizationFailureReason =
  | "application_mismatch"
  | "forum_mismatch"
  | "guild_mismatch"
  | "operator_not_allowed"
  | "thread_mismatch"
  | "wrong_channel_type";

export interface DiscordCommandAuthorizationPolicy {
  readonly applicationId: string;
  readonly guildId: string;
  readonly forumChannelId: string;
  readonly discordThreadId: string;
  readonly operatorUserIds: readonly string[];
  readonly operatorRoleIds: readonly string[];
}

export type DiscordAuthorizationResult =
  | { readonly ok: true; readonly matchedBy: "role" | "user" }
  | { readonly ok: false; readonly reason: DiscordAuthorizationFailureReason };

export function authorizeDiscordCommand(
  interaction: ParsedDiscordCommandInteraction,
  policy: DiscordCommandAuthorizationPolicy,
): DiscordAuthorizationResult {
  if (interaction.applicationId !== policy.applicationId) {
    return { ok: false, reason: "application_mismatch" };
  }
  if (interaction.guildId !== policy.guildId) {
    return { ok: false, reason: "guild_mismatch" };
  }
  if (interaction.discordThreadId !== policy.discordThreadId) {
    return { ok: false, reason: "thread_mismatch" };
  }
  if (interaction.threadType !== DiscordChannelType.GuildPublicThread) {
    return { ok: false, reason: "wrong_channel_type" };
  }
  if (interaction.forumChannelId !== policy.forumChannelId) {
    return { ok: false, reason: "forum_mismatch" };
  }
  if (policy.operatorUserIds.includes(interaction.operatorUserId)) {
    return { ok: true, matchedBy: "user" };
  }
  if (interaction.operatorRoleIds.some((roleId) => policy.operatorRoleIds.includes(roleId))) {
    return { ok: true, matchedBy: "role" };
  }
  return { ok: false, reason: "operator_not_allowed" };
}

export interface NormalizedDiscordCommandBase {
  readonly interactionId: string;
  readonly applicationId: string;
  readonly guildId: string;
  readonly discordThreadId: string;
  readonly operatorUserId: string;
  readonly operatorRoleIds: readonly string[];
}

export type NormalizedDiscordCommand =
  | (NormalizedDiscordCommandBase &
      Pick<
        ParsedDiscordActivityInteraction,
        "command" | "count" | "minutes" | "activityKind" | "until"
      >)
  | (NormalizedDiscordCommandBase &
      Pick<
        ParsedDiscordTranslateInteraction,
        "command" | "targetLanguage" | "targetMessageId" | "messageLink"
      >)
  | (NormalizedDiscordCommandBase &
      Pick<ParsedDiscordConfirmInteraction, "command" | "reference" | "generation">)
  | (NormalizedDiscordCommandBase & {
      readonly command: "reply";
      readonly message: string;
      readonly translate?: string;
    })
  | (NormalizedDiscordCommandBase & {
      readonly command: "retry";
      readonly reference: string;
      readonly message: string;
    })
  | (NormalizedDiscordCommandBase & {
      readonly command: "status";
      readonly reference: string;
    });

export function normalizeDiscordCommand(
  interaction: ParsedDiscordCommandInteraction,
): NormalizedDiscordCommand {
  const base = {
    interactionId: interaction.interactionId,
    applicationId: interaction.applicationId,
    guildId: interaction.guildId,
    discordThreadId: interaction.discordThreadId,
    operatorUserId: interaction.operatorUserId,
    operatorRoleIds: [...interaction.operatorRoleIds],
  };
  if (interaction.command === "activity")
    return {
      ...base,
      command: interaction.command,
      count: interaction.count,
      minutes: interaction.minutes,
      activityKind: interaction.activityKind,
      until: interaction.until,
    };
  if (interaction.command === "translate") {
    return {
      ...base,
      command: interaction.command,
      targetLanguage: interaction.targetLanguage,
      ...(interaction.targetMessageId === undefined
        ? {}
        : { targetMessageId: interaction.targetMessageId }),
      ...(interaction.messageLink === undefined ? {} : { messageLink: interaction.messageLink }),
    };
  }
  if (interaction.command === "confirm_translation")
    return {
      ...base,
      command: interaction.command,
      reference: interaction.reference,
      generation: interaction.generation,
    };
  if (interaction.command === "reply") {
    return {
      ...base,
      command: interaction.command,
      message: interaction.message,
      translate: interaction.translate ?? "off",
    };
  }
  if (interaction.command === "status") {
    return { ...base, command: interaction.command, reference: interaction.reference };
  }
  return {
    ...base,
    command: interaction.command,
    reference: interaction.reference,
    message: interaction.message,
  };
}

export function createEphemeralInteractionResponse(content: string): {
  readonly type: typeof DiscordInteractionResponseType.ChannelMessageWithSource;
  readonly data: {
    readonly content: string;
    readonly flags: typeof DiscordMessageFlag.Ephemeral;
    readonly allowed_mentions: { readonly parse: readonly [] };
  };
} {
  return {
    type: DiscordInteractionResponseType.ChannelMessageWithSource,
    data: {
      content,
      flags: DiscordMessageFlag.Ephemeral,
      allowed_mentions: { parse: [] },
    },
  };
}

export const DISCORD_PONG_RESPONSE = {
  type: DiscordInteractionResponseType.Pong,
} as const;

function requireAllowedOptions(
  options: ReadonlyMap<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
) {
  if (
    required.some((name) => !options.has(name)) ||
    [...options.keys()].some((name) => !required.includes(name) && !optional.includes(name))
  ) {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      "Unexpected or missing command options",
    );
  }
}

export function normalizeTranslationLanguage(value: string): string {
  try {
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value) || value.length > 35) throw new Error();
    return new Intl.Locale(value).baseName;
  } catch {
    throw new DiscordInteractionParseError(
      "invalid_payload",
      "Use a language code such as en, hi, or my",
    );
  }
}

function normalizeReplyTranslation(value: string): string {
  return value === "off" || value === "customer" ? value : normalizeTranslationLanguage(value);
}

export function createDeferredEphemeralResponse() {
  return {
    type: DiscordInteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: DiscordMessageFlag.Ephemeral },
  } as const;
}
