const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
export const DISCORD_MESSAGE_MAX_LENGTH = 2_000;
export const DISCORD_NONCE_MAX_LENGTH = 25;

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

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
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

    const responseBody = parseResponseBody(await response.text());
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

    return responseBody as T;
  }

  async getChannel(channelId: string): Promise<DiscordChannel> {
    assertIdentifier(channelId, "Discord channel ID");
    return this.#request("GET", `/channels/${channelId}`);
  }

  async createForumThread(input: CreateDiscordForumThreadInput): Promise<DiscordForumThread> {
    assertIdentifier(input.forumChannelId, "Discord forum channel ID");
    assertMessageContent(input.starterContent);
    if (input.name.length === 0 || input.name.length > 100) {
      throw new RangeError("Discord forum thread name must contain 1-100 characters");
    }

    const result = await this.#request<Record<string, unknown>>(
      "POST",
      `/channels/${input.forumChannelId}/threads`,
      {
        name: input.name,
        message: {
          content: input.starterContent,
          allowed_mentions: DISCORD_ALLOWED_MENTIONS_NONE,
        },
      },
    );
    const message = isRecord(result.message)
      ? (result.message as unknown as DiscordMessage)
      : undefined;
    const { message: _message, ...thread } = result;
    return {
      thread: thread as unknown as DiscordChannel,
      starterMessage: message,
    };
  }

  async listActiveGuildThreads(guildId: string): Promise<readonly DiscordChannel[]> {
    assertIdentifier(guildId, "Discord guild ID");
    const result = await this.#request<{ readonly threads?: readonly DiscordChannel[] }>(
      "GET",
      `/guilds/${guildId}/threads/active`,
    );
    return Array.isArray(result.threads) ? result.threads : [];
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
    const result = await this.#request<{ readonly threads?: readonly DiscordChannel[] }>(
      "GET",
      `/channels/${forumChannelId}/threads/archived/public${suffix}`,
    );
    return Array.isArray(result.threads) ? result.threads : [];
  }

  async getMessage(channelId: string, messageId: string): Promise<DiscordMessage> {
    assertIdentifier(channelId, "Discord channel ID");
    assertIdentifier(messageId, "Discord message ID");
    return this.#request("GET", `/channels/${channelId}/messages/${messageId}`);
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
    return this.#request("GET", `/channels/${channelId}/messages${suffix}`);
  }

  async findMessageByNonce(channelId: string, nonce: string): Promise<DiscordMessage | undefined> {
    assertNonce(nonce);
    const messages = await this.listMessages(channelId, { limit: 100 });
    return messages.find(
      (message) => message.nonce !== undefined && String(message.nonce) === nonce,
    );
  }

  async sendMessage(input: SendDiscordMessageInput): Promise<DiscordMessage> {
    assertIdentifier(input.channelId, "Discord channel ID");
    assertMessageContent(input.content);
    assertNonce(input.nonce);
    return this.#request("POST", `/channels/${input.channelId}/messages`, {
      content: input.content,
      nonce: input.nonce,
      enforce_nonce: true,
      allowed_mentions: DISCORD_ALLOWED_MENTIONS_NONE,
    });
  }

  async sendMessageReconciled(input: SendDiscordMessageInput): Promise<DiscordMessageResult> {
    const existing = await this.findMessageByNonce(input.channelId, input.nonce);
    if (existing !== undefined) {
      return { message: existing, reconciled: true };
    }
    try {
      return { message: await this.sendMessage(input), reconciled: false };
    } catch (error) {
      if (!(error instanceof DiscordRestError) || !error.retryable) {
        throw error;
      }
      const reconciled = await this.findMessageByNonce(input.channelId, input.nonce);
      if (reconciled !== undefined) {
        return { message: reconciled, reconciled: true };
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
    const maximumCandidates = input.maximumCandidates ?? 50;
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
    if (activeMatch !== undefined || active.length === maximumCandidates) {
      return activeMatch;
    }

    const archived = await this.listPublicArchivedThreads(input.forumChannelId, {
      limit: maximumCandidates - active.length,
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
