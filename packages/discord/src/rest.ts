const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
export const DISCORD_MESSAGE_MAX_LENGTH = 2_000;
export const DISCORD_NONCE_MAX_LENGTH = 25;
/** One Discord list call; callers may raise this only by adding explicit pagination. */
export const DISCORD_MESSAGE_RECONCILIATION_CANDIDATE_LIMIT = 100;
/** Applied independently to active and archived forum-thread collections. */
export const DISCORD_THREAD_RECONCILIATION_CANDIDATE_LIMIT = 50;

const RETRYABLE_HTTP_STATUSES = new Set([408, 429]);
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export interface DiscordAllowedMentionsNone {
  readonly parse: readonly [];
}

export const DISCORD_ALLOWED_MENTIONS_NONE: DiscordAllowedMentionsNone = {
  parse: [],
};

export interface DiscordChannel {
  readonly id: string;
  readonly type: number;
  readonly guild_id?: string;
  readonly parent_id?: string | null;
  readonly name?: string;
  readonly thread_metadata?: {
    readonly archived?: boolean;
    readonly locked?: boolean;
    readonly archive_timestamp?: string;
  };
}

export interface DiscordMessage {
  readonly id: string;
  readonly channel_id: string;
  readonly content: string;
  readonly nonce?: string | number | null;
}

export interface DiscordForumThread {
  readonly thread: DiscordChannel;
  readonly starterMessage: DiscordMessage | undefined;
}

export interface DiscordRateLimitDetails {
  readonly retryAfterMs: number | undefined;
  readonly global: boolean;
}

export class DiscordRestError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number | undefined;
  readonly discordCode: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly globalRateLimit: boolean;
  override readonly cause: unknown;

  constructor(input: {
    readonly message: string;
    readonly method: string;
    readonly path: string;
    readonly status?: number;
    readonly discordCode?: number;
    readonly retryable: boolean;
    readonly retryAfterMs?: number;
    readonly globalRateLimit?: boolean;
    readonly cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "DiscordRestError";
    this.method = input.method;
    this.path = input.path;
    this.status = input.status;
    this.discordCode = input.discordCode;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
    this.globalRateLimit = input.globalRateLimit ?? false;
    this.cause = input.cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function durationSecondsToMs(value: unknown): number | undefined {
  const seconds = numberFromUnknown(value);
  if (seconds === undefined || seconds < 0) {
    return undefined;
  }
  return Math.ceil(seconds * 1_000);
}

export function classifyDiscordHttpStatus(status: number): "permanent" | "retryable" {
  return RETRYABLE_HTTP_STATUSES.has(status) || (status >= 500 && status <= 599)
    ? "retryable"
    : "permanent";
}

export function readDiscordRateLimitDetails(
  response: Pick<Response, "headers" | "status">,
  body: unknown,
): DiscordRateLimitDetails {
  const record = isRecord(body) ? body : undefined;
  const bodyRetryAfter = durationSecondsToMs(record?.retry_after);
  const retryAfterHeader = durationSecondsToMs(response.headers.get("retry-after"));
  const bucketResetAfter = durationSecondsToMs(response.headers.get("x-ratelimit-reset-after"));
  return {
    retryAfterMs: bodyRetryAfter ?? retryAfterHeader ?? bucketResetAfter,
    global:
      record?.global === true ||
      response.headers.get("x-ratelimit-global")?.toLowerCase() === "true",
  };
}

function parseResponseBody(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function discordErrorMessage(body: unknown, status: number): string {
  if (isRecord(body) && typeof body.message === "string" && body.message.length > 0) {
    return body.message;
  }
  return `Discord REST request failed with HTTP ${status}`;
}

function discordErrorCode(body: unknown): number | undefined {
  return isRecord(body) && typeof body.code === "number" ? body.code : undefined;
}

function assertIdentifier(value: string, description: string): void {
  if (!/^\d{1,32}$/.test(value)) {
    throw new TypeError(`${description} must be a Discord snowflake`);
  }
}

function assertMessageContent(content: string): void {
  if (content.length === 0 || content.length > DISCORD_MESSAGE_MAX_LENGTH) {
    throw new RangeError(
      `Discord message content must contain 1-${DISCORD_MESSAGE_MAX_LENGTH} UTF-16 code units`,
    );
  }
  const lastCodeUnit = content.charCodeAt(content.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    throw new RangeError("Discord message content may not end with a split surrogate pair");
  }
}

function assertNonce(nonce: string): void {
  if (nonce.length === 0 || nonce.length > DISCORD_NONCE_MAX_LENGTH) {
    throw new RangeError(`Discord nonce must contain 1-${DISCORD_NONCE_MAX_LENGTH} characters`);
  }
}

function requiredRecord(value: unknown, description: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${description} must be an object`);
  }
  return value;
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  description: string,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new TypeError(`${description}.${field} must be a string`);
  }
  return value;
}

function parseDiscordChannel(value: unknown, description: string): DiscordChannel {
  const record = requiredRecord(value, description);
  const id = requiredString(record, "id", description);
  assertIdentifier(id, `${description}.id`);
  if (!Number.isSafeInteger(record.type) || (record.type as number) < 0) {
    throw new TypeError(`${description}.type must be a non-negative integer`);
  }

  const guildId = record.guild_id;
  if (guildId !== undefined) {
    if (typeof guildId !== "string") {
      throw new TypeError(`${description}.guild_id must be a string when present`);
    }
    assertIdentifier(guildId, `${description}.guild_id`);
  }

  const parentId = record.parent_id;
  if (parentId !== undefined && parentId !== null) {
    if (typeof parentId !== "string") {
      throw new TypeError(`${description}.parent_id must be a string or null when present`);
    }
    assertIdentifier(parentId, `${description}.parent_id`);
  }

  const name = record.name;
  if (name !== undefined && name !== null && typeof name !== "string") {
    throw new TypeError(`${description}.name must be a string or null when present`);
  }

  const metadataValue = record.thread_metadata;
  let threadMetadata: DiscordChannel["thread_metadata"];
  if (metadataValue !== undefined) {
    const metadata = requiredRecord(metadataValue, `${description}.thread_metadata`);
    for (const field of ["archived", "locked"] as const) {
      if (metadata[field] !== undefined && typeof metadata[field] !== "boolean") {
        throw new TypeError(`${description}.thread_metadata.${field} must be boolean when present`);
      }
    }
    const archiveTimestamp = metadata.archive_timestamp;
    if (
      archiveTimestamp !== undefined &&
      (typeof archiveTimestamp !== "string" || Number.isNaN(Date.parse(archiveTimestamp)))
    ) {
      throw new TypeError(
        `${description}.thread_metadata.archive_timestamp must be ISO8601 when present`,
      );
    }
    threadMetadata = {
      ...(typeof metadata.archived === "boolean" ? { archived: metadata.archived } : {}),
      ...(typeof metadata.locked === "boolean" ? { locked: metadata.locked } : {}),
      ...(typeof archiveTimestamp === "string" ? { archive_timestamp: archiveTimestamp } : {}),
    };
  }

  return {
    id,
    type: record.type as number,
    ...(typeof guildId === "string" ? { guild_id: guildId } : {}),
    ...(parentId === null || typeof parentId === "string" ? { parent_id: parentId } : {}),
    ...(typeof name === "string" ? { name } : {}),
    ...(threadMetadata === undefined ? {} : { thread_metadata: threadMetadata }),
  };
}

function parseDiscordMessage(value: unknown, description: string): DiscordMessage {
  const record = requiredRecord(value, description);
  const id = requiredString(record, "id", description);
  const channelId = requiredString(record, "channel_id", description);
  const content = requiredString(record, "content", description);
  assertIdentifier(id, `${description}.id`);
  assertIdentifier(channelId, `${description}.channel_id`);
  const nonce = record.nonce;
  if (
    nonce !== undefined &&
    nonce !== null &&
    typeof nonce !== "string" &&
    !(typeof nonce === "number" && Number.isSafeInteger(nonce))
  ) {
    throw new TypeError(
      `${description}.nonce must be a string, safe integer, or null when present`,
    );
  }
  return {
    id,
    channel_id: channelId,
    content,
    ...(nonce === undefined ? {} : { nonce: nonce as string | number | null }),
  };
}

function assertMessageResponse(
  message: DiscordMessage,
  expected: {
    readonly channelId: string;
    readonly id?: string;
    readonly content?: string;
    readonly nonce?: string;
  },
  description: string,
): void {
  if (message.channel_id !== expected.channelId) {
    throw new TypeError(`${description}.channel_id does not match the requested channel`);
  }
  if (expected.id !== undefined && message.id !== expected.id) {
    throw new TypeError(`${description}.id does not match the requested message`);
  }
  if (expected.content !== undefined && message.content !== expected.content) {
    throw new TypeError(`${description}.content does not match the submitted content`);
  }
  if (expected.nonce !== undefined && String(message.nonce) !== expected.nonce) {
    throw new TypeError(`${description}.nonce does not match the submitted nonce`);
  }
}

function parseDiscordForumThread(
  value: unknown,
  input: CreateDiscordForumThreadInput,
): DiscordForumThread {
  const record = requiredRecord(value, "Discord forum-thread response");
  const thread = parseDiscordChannel(record, "Discord forum-thread response");
  if (thread.type !== 11) {
    throw new TypeError("Discord forum-thread response.type must be PUBLIC_THREAD (11)");
  }
  if (thread.parent_id !== input.forumChannelId) {
    throw new TypeError("Discord forum-thread response.parent_id does not match the forum");
  }
  const starterMessage = parseDiscordMessage(
    record.message,
    "Discord forum-thread response.message",
  );
  assertMessageResponse(
    starterMessage,
    { channelId: thread.id, id: thread.id, content: input.starterContent },
    "Discord forum-thread response.message",
  );
  return { thread, starterMessage };
}

function fnv1a64(value: string): string {
  let hash = FNV64_OFFSET_BASIS;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export function createDiscordNonce(seed: string, chunkIndex: number): string {
  if (seed.length === 0) {
    throw new TypeError("Discord nonce seed must not be empty");
  }
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    throw new RangeError("Discord chunk index must be a non-negative safe integer");
  }
  const nonce = `ac-${chunkIndex.toString(36)}-${fnv1a64(seed)}`;
  if (nonce.length > DISCORD_NONCE_MAX_LENGTH) {
    throw new RangeError("Discord chunk index is too large for a deterministic nonce");
  }
  return nonce;
}

export function createDiscordCorrelationMarker(seed: string): string {
  if (seed.length === 0) {
    throw new TypeError("Discord correlation seed must not be empty");
  }
  return `ac:${fnv1a64(seed)}`;
}

export function splitDiscordMessage(
  content: string,
  maximumLength = DISCORD_MESSAGE_MAX_LENGTH,
): readonly string[] {
  if (content.length === 0) {
    throw new RangeError("Discord message content must not be empty");
  }
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 2) {
    throw new RangeError("Discord chunk length must be an integer of at least two");
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let end = Math.min(offset + maximumLength, content.length);
    if (end < content.length) {
      const previousCodeUnit = content.charCodeAt(end - 1);
      const nextCodeUnit = content.charCodeAt(end);
      if (
        previousCodeUnit >= 0xd800 &&
        previousCodeUnit <= 0xdbff &&
        nextCodeUnit >= 0xdc00 &&
        nextCodeUnit <= 0xdfff
      ) {
        end -= 1;
      }
    }
    chunks.push(content.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export interface DiscordRestClientOptions {
  readonly botToken: string;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly userAgent?: string;
}

export interface CreateDiscordForumThreadInput {
  readonly forumChannelId: string;
  readonly name: string;
  readonly starterContent: string;
}

export interface ReconcileDiscordForumThreadInput {
  readonly guildId: string;
  readonly forumChannelId: string;
  readonly correlationMarker: string;
  /** Maximum starter messages inspected from each active and archived collection. */
  readonly maximumCandidates?: number;
}

export interface CreateReconciledDiscordForumThreadInput
  extends CreateDiscordForumThreadInput, ReconcileDiscordForumThreadInput {}

export interface DiscordForumThreadResult {
  readonly thread: DiscordChannel;
  readonly starterMessage: DiscordMessage | undefined;
  readonly reconciled: boolean;
}

export interface SendDiscordMessageInput {
  readonly channelId: string;
  readonly content: string;
  readonly nonce: string;
}

export interface DiscordMessageResult {
  readonly message: DiscordMessage;
  readonly reconciled: boolean;
}

export interface ListDiscordMessagesInput {
  readonly after?: string;
  readonly around?: string;
  readonly before?: string;
  readonly limit?: number;
}

function requireMatchingReconciledMessage(
  input: SendDiscordMessageInput,
  message: DiscordMessage,
): DiscordMessage {
  try {
    assertMessageResponse(
      message,
      { channelId: input.channelId, content: input.content, nonce: input.nonce },
      "Discord reconciled message",
    );
    return message;
  } catch (cause) {
    throw new DiscordRestError({
      message: "Discord nonce resolved to a message with different canonical content",
      method: "GET",
      path: `/channels/${input.channelId}/messages`,
      retryable: false,
      cause,
    });
  }
}

export class DiscordRestClient {
  readonly #botToken: string;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  readonly #userAgent: string | undefined;

  constructor(options: DiscordRestClientOptions) {
    if (options.botToken.length === 0) {
      throw new TypeError("Discord bot token must not be empty");
    }
    this.#botToken = options.botToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#baseUrl = (options.baseUrl ?? DISCORD_API_BASE_URL).replace(/\/$/, "");
    this.#userAgent = options.userAgent;
  }

  async #request<T>(
    method: string,
    path: string,
    parse: (body: unknown) => T,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bot ${this.#botToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.#userAgent === undefined ? {} : { "user-agent": this.#userAgent }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new DiscordRestError({
        message: "Discord REST request failed before receiving a response",
        method,
        path,
        retryable: true,
        cause,
      });
    }

    let responseText: string;
    try {
      responseText = await response.text();
    } catch (cause) {
      throw new DiscordRestError({
        message: "Discord REST response body could not be read",
        method,
        path,
        status: response.status,
        retryable: response.ok || classifyDiscordHttpStatus(response.status) === "retryable",
        cause,
      });
    }

    const responseBody = parseResponseBody(responseText);
    if (!response.ok) {
      const rateLimit = readDiscordRateLimitDetails(response, responseBody);
      const discordCode = discordErrorCode(responseBody);
      throw new DiscordRestError({
        message: discordErrorMessage(responseBody, response.status),
        method,
        path,
        status: response.status,
        ...(discordCode === undefined ? {} : { discordCode }),
        retryable: classifyDiscordHttpStatus(response.status) === "retryable",
        ...(rateLimit.retryAfterMs === undefined ? {} : { retryAfterMs: rateLimit.retryAfterMs }),
        globalRateLimit: rateLimit.global,
      });
    }

    try {
      return parse(responseBody);
    } catch (cause) {
      if (cause instanceof DiscordRestError) {
        throw cause;
      }
      const reason = cause instanceof Error ? `: ${cause.message}` : "";
      throw new DiscordRestError({
        message: `Discord REST returned an invalid successful response${reason}`,
        method,
        path,
        status: response.status,
        retryable: true,
        cause,
      });
    }
  }

  async getChannel(channelId: string): Promise<DiscordChannel> {
    assertIdentifier(channelId, "Discord channel ID");
    return this.#request("GET", `/channels/${channelId}`, (body) => {
      const channel = parseDiscordChannel(body, "Discord channel response");
      if (channel.id !== channelId) {
        throw new TypeError("Discord channel response.id does not match the requested channel");
      }
      return channel;
    });
  }

  async createForumThread(input: CreateDiscordForumThreadInput): Promise<DiscordForumThread> {
    assertIdentifier(input.forumChannelId, "Discord forum channel ID");
    assertMessageContent(input.starterContent);
    if (input.name.length === 0 || input.name.length > 100) {
      throw new RangeError("Discord forum thread name must contain 1-100 characters");
    }

    return this.#request(
      "POST",
      `/channels/${input.forumChannelId}/threads`,
      (body) => parseDiscordForumThread(body, input),
      {
        name: input.name,
        message: {
          content: input.starterContent,
          allowed_mentions: DISCORD_ALLOWED_MENTIONS_NONE,
        },
      },
    );
  }

  async listActiveGuildThreads(guildId: string): Promise<readonly DiscordChannel[]> {
    assertIdentifier(guildId, "Discord guild ID");
    return this.#request("GET", `/guilds/${guildId}/threads/active`, (body) => {
      const record = requiredRecord(body, "Discord active-thread response");
      if (!Array.isArray(record.threads)) {
        throw new TypeError("Discord active-thread response.threads must be an array");
      }
      return record.threads.map((thread, index) =>
        parseDiscordChannel(thread, `Discord active-thread response.threads[${index}]`),
      );
    });
  }

  async listPublicArchivedThreads(
    forumChannelId: string,
    input: { readonly before?: string; readonly limit?: number } = {},
  ): Promise<readonly DiscordChannel[]> {
    assertIdentifier(forumChannelId, "Discord forum channel ID");
    const query = new URLSearchParams();
    if (input.before !== undefined) {
      query.set("before", input.before);
    }
    if (input.limit !== undefined) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new RangeError("Discord archived thread limit must be 1-100");
      }
      query.set("limit", String(input.limit));
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return this.#request(
      "GET",
      `/channels/${forumChannelId}/threads/archived/public${suffix}`,
      (body) => {
        const record = requiredRecord(body, "Discord archived-thread response");
        if (!Array.isArray(record.threads)) {
          throw new TypeError("Discord archived-thread response.threads must be an array");
        }
        return record.threads.map((thread, index) => {
          const channel = parseDiscordChannel(
            thread,
            `Discord archived-thread response.threads[${index}]`,
          );
          if (channel.parent_id !== forumChannelId) {
            throw new TypeError(
              `Discord archived-thread response.threads[${index}].parent_id does not match the forum`,
            );
          }
          return channel;
        });
      },
    );
  }

  async getMessage(channelId: string, messageId: string): Promise<DiscordMessage> {
    assertIdentifier(channelId, "Discord channel ID");
    assertIdentifier(messageId, "Discord message ID");
    return this.#request("GET", `/channels/${channelId}/messages/${messageId}`, (body) => {
      const message = parseDiscordMessage(body, "Discord message response");
      assertMessageResponse(message, { channelId, id: messageId }, "Discord message response");
      return message;
    });
  }

  async listMessages(
    channelId: string,
    input: ListDiscordMessagesInput = {},
  ): Promise<readonly DiscordMessage[]> {
    assertIdentifier(channelId, "Discord channel ID");
    const cursorCount = [input.after, input.around, input.before].filter(
      (value) => value !== undefined,
    ).length;
    if (cursorCount > 1) {
      throw new TypeError("Discord message listing accepts only one cursor");
    }
    const query = new URLSearchParams();
    for (const [name, value] of [
      ["after", input.after],
      ["around", input.around],
      ["before", input.before],
    ] as const) {
      if (value !== undefined) {
        assertIdentifier(value, `Discord ${name} cursor`);
        query.set(name, value);
      }
    }
    if (input.limit !== undefined) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new RangeError("Discord message limit must be 1-100");
      }
      query.set("limit", String(input.limit));
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return this.#request("GET", `/channels/${channelId}/messages${suffix}`, (body) => {
      if (!Array.isArray(body)) {
        throw new TypeError("Discord message-list response must be an array");
      }
      return body.map((value, index) => {
        const message = parseDiscordMessage(value, `Discord message-list response[${index}]`);
        assertMessageResponse(message, { channelId }, `Discord message-list response[${index}]`);
        return message;
      });
    });
  }

  /**
   * Searches Discord's newest 100 messages (the route maximum). This is an
   * intentionally bounded fallback after D1/enforce_nonce reconciliation.
   */
  async findMessageByNonce(channelId: string, nonce: string): Promise<DiscordMessage | undefined> {
    assertNonce(nonce);
    const messages = await this.listMessages(channelId, {
      limit: DISCORD_MESSAGE_RECONCILIATION_CANDIDATE_LIMIT,
    });
    return messages.find(
      (message) => message.nonce !== undefined && String(message.nonce) === nonce,
    );
  }

  async sendMessage(input: SendDiscordMessageInput): Promise<DiscordMessage> {
    assertIdentifier(input.channelId, "Discord channel ID");
    assertMessageContent(input.content);
    assertNonce(input.nonce);
    return this.#request(
      "POST",
      `/channels/${input.channelId}/messages`,
      (body) => {
        const message = parseDiscordMessage(body, "Discord send-message response");
        assertMessageResponse(
          message,
          { channelId: input.channelId, content: input.content, nonce: input.nonce },
          "Discord send-message response",
        );
        return message;
      },
      {
        content: input.content,
        nonce: input.nonce,
        enforce_nonce: true,
        allowed_mentions: DISCORD_ALLOWED_MENTIONS_NONE,
      },
    );
  }

  async sendMessageReconciled(input: SendDiscordMessageInput): Promise<DiscordMessageResult> {
    const existing = await this.findMessageByNonce(input.channelId, input.nonce);
    if (existing !== undefined) {
      return { message: requireMatchingReconciledMessage(input, existing), reconciled: true };
    }
    try {
      return { message: await this.sendMessage(input), reconciled: false };
    } catch (error) {
      if (!(error instanceof DiscordRestError) || !error.retryable) {
        throw error;
      }
      const reconciled = await this.findMessageByNonce(input.channelId, input.nonce);
      if (reconciled !== undefined) {
        return {
          message: requireMatchingReconciledMessage(input, reconciled),
          reconciled: true,
        };
      }
      throw error;
    }
  }

  async findForumThreadByCorrelationMarker(
    input: ReconcileDiscordForumThreadInput,
  ): Promise<DiscordForumThread | undefined> {
    assertIdentifier(input.guildId, "Discord guild ID");
    assertIdentifier(input.forumChannelId, "Discord forum channel ID");
    if (input.correlationMarker.length === 0) {
      throw new TypeError("Discord correlation marker must not be empty");
    }
    const maximumCandidates =
      input.maximumCandidates ?? DISCORD_THREAD_RECONCILIATION_CANDIDATE_LIMIT;
    if (
      !Number.isSafeInteger(maximumCandidates) ||
      maximumCandidates < 1 ||
      maximumCandidates > 100
    ) {
      throw new RangeError("Discord reconciliation candidate limit must be 1-100");
    }

    const findInCandidates = async (
      candidates: readonly DiscordChannel[],
    ): Promise<DiscordForumThread | undefined> => {
      for (const thread of candidates) {
        try {
          const starterMessage = await this.getMessage(thread.id, thread.id);
          if (starterMessage.content.includes(input.correlationMarker)) {
            return { thread, starterMessage };
          }
        } catch (error) {
          if (!(error instanceof DiscordRestError) || error.status !== 404) {
            throw error;
          }
        }
      }
      return undefined;
    };

    const active = (await this.listActiveGuildThreads(input.guildId))
      .filter((thread) => thread.parent_id === input.forumChannelId)
      .slice(0, maximumCandidates);
    const activeMatch = await findInCandidates(active);
    if (activeMatch !== undefined) {
      return activeMatch;
    }

    const archived = await this.listPublicArchivedThreads(input.forumChannelId, {
      limit: maximumCandidates,
    });
    const activeIds = new Set(active.map((thread) => thread.id));
    return findInCandidates(archived.filter((thread) => !activeIds.has(thread.id)));
  }

  async createForumThreadReconciled(
    input: CreateReconciledDiscordForumThreadInput,
  ): Promise<DiscordForumThreadResult> {
    const existing = await this.findForumThreadByCorrelationMarker(input);
    if (existing !== undefined) {
      return { ...existing, reconciled: true };
    }
    try {
      return { ...(await this.createForumThread(input)), reconciled: false };
    } catch (error) {
      if (!(error instanceof DiscordRestError) || !error.retryable) {
        throw error;
      }
      const reconciled = await this.findForumThreadByCorrelationMarker(input);
      if (reconciled !== undefined) {
        return { ...reconciled, reconciled: true };
      }
      throw error;
    }
  }
}
