import {
  API_VERSION,
  ApiErrorResponseV1Schema,
  CreateClientSessionRequestV1Schema,
  CreateClientSessionResponseV1Schema,
  CreateThreadRequestV1Schema,
  CreateThreadResponseV1Schema,
  ListMessagesQueryV1Schema,
  ListMessagesResponseV1Schema,
  SendMessageRequestV1Schema,
  SendMessageResponseV1Schema,
  SessionTokenSchema,
  ThreadIdSchema,
  type ApiErrorCode,
  type ClientMessageId,
  type CreateClientSessionRequestV1,
  type CreateClientSessionResponseV1,
  type CreateThreadRequestV1,
  type CreateThreadResponseV1,
  type ListMessagesQueryV1,
  type ListMessagesResponseV1,
  type SendMessageRequestV1,
  type SendMessageResponseV1,
  type SessionToken,
  type ThreadId,
} from "@respondkit/protocol";

const DEFAULT_ACCEPTANCE_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;

export interface AcceptanceRetryOptions {
  /** Total attempts, including the first request. */
  readonly attempts?: number | undefined;
  readonly delayMs?: number | undefined;
  readonly maxDelayMs?: number | undefined;
}

export interface RespondKitClientOptions {
  readonly baseUrl: string;
  /** Resolved lazily so importing this package is safe during SSR. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly acceptanceRetry?: AcceptanceRetryOptions | undefined;
}

export interface RequestOptions {
  readonly signal?: AbortSignal | undefined;
}

export interface RespondKitClient {
  createSession(
    input: CreateClientSessionRequestV1,
    options?: RequestOptions,
  ): Promise<CreateClientSessionResponseV1>;
  createThread(
    sessionToken: SessionToken,
    input: CreateThreadRequestV1,
    options?: RequestOptions,
  ): Promise<CreateThreadResponseV1>;
  listMessages(
    sessionToken: SessionToken,
    threadId: ThreadId,
    query?: ListMessagesQueryV1,
    options?: RequestOptions,
  ): Promise<ListMessagesResponseV1>;
  sendMessage(
    sessionToken: SessionToken,
    threadId: ThreadId,
    input: SendMessageRequestV1,
    options?: RequestOptions,
  ): Promise<SendMessageResponseV1>;
}

export interface RespondKitClientErrorOptions {
  readonly code: ApiErrorCode;
  readonly status?: number | undefined;
  readonly retryable: boolean;
  readonly requestId?: string | undefined;
  readonly clientMessageId?: ClientMessageId | undefined;
  readonly cause?: unknown;
}

export class RespondKitClientError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly requestId: string | undefined;
  readonly clientMessageId: ClientMessageId | undefined;

  constructor(message: string, options: RespondKitClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "RespondKitClientError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
    this.clientMessageId = options.clientMessageId;
  }
}

interface NormalizedRetryOptions {
  readonly attempts: number;
  readonly delayMs: number;
  readonly maxDelayMs: number;
}

function normalizeBaseUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.length === 0) {
    throw new TypeError("RespondKit baseUrl must not be empty");
  }
  return normalized;
}

function normalizeRetryOptions(options: AcceptanceRetryOptions | undefined) {
  const retry: NormalizedRetryOptions = {
    attempts: options?.attempts ?? DEFAULT_ACCEPTANCE_ATTEMPTS,
    delayMs: options?.delayMs ?? DEFAULT_RETRY_DELAY_MS,
    maxDelayMs: options?.maxDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
  };

  if (!Number.isInteger(retry.attempts) || retry.attempts < 1 || retry.attempts > 10) {
    throw new TypeError("acceptanceRetry.attempts must be an integer from 1 to 10");
  }
  if (!Number.isFinite(retry.delayMs) || retry.delayMs < 0) {
    throw new TypeError("acceptanceRetry.delayMs must be a non-negative number");
  }
  if (!Number.isFinite(retry.maxDelayMs) || retry.maxDelayMs < retry.delayMs) {
    throw new TypeError("acceptanceRetry.maxDelayMs must be at least delayMs");
  }

  return retry;
}

function resolveFetch(explicitFetch: typeof globalThis.fetch | undefined) {
  const fetchImplementation = explicitFetch ?? globalThis.fetch;
  if (fetchImplementation === undefined) {
    throw new RespondKitClientError(
      "No Fetch API implementation is available; pass fetch when creating the client",
      { code: "unavailable", retryable: false },
    );
  }
  return fetchImplementation;
}

function authorizationHeaders(baseHeaders: Readonly<Record<string, string>>, token?: SessionToken) {
  return {
    ...baseHeaders,
    accept: "application/json",
    "content-type": "application/json",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  };
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new RespondKitClientError("RespondKit returned a non-JSON response", {
      code: "internal_error",
      status: response.status,
      retryable: response.status >= 500,
      cause,
    });
  }
}

function serverError(response: Response, body: unknown): RespondKitClientError {
  const parsed = ApiErrorResponseV1Schema.safeParse(body);
  if (parsed.success) {
    return new RespondKitClientError(parsed.data.error.message, {
      code: parsed.data.error.code,
      status: response.status,
      retryable: parsed.data.error.retryable,
      requestId: parsed.data.error.requestId,
    });
  }

  return new RespondKitClientError(`RespondKit request failed with HTTP ${response.status}`, {
    code: response.status === 429 ? "rate_limited" : "internal_error",
    status: response.status,
    retryable: response.status === 408 || response.status === 429 || response.status >= 500,
  });
}

interface RuntimeSchema<T> {
  safeParse(
    input: unknown,
  ):
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: unknown };
}

function parseSuccess<T>(schema: RuntimeSchema<T>, response: Response, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new RespondKitClientError("RespondKit returned an invalid protocol response", {
      code: "internal_error",
      status: response.status,
      retryable: false,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function shouldRetryStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function retryAfterMilliseconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (value === null) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function retryDelay(retry: NormalizedRetryOptions, completedAttempts: number, response?: Response) {
  const serverDelay = response === undefined ? undefined : retryAfterMilliseconds(response);
  if (serverDelay !== undefined) return Math.min(serverDelay, retry.maxDelayMs);
  return Math.min(retry.delayMs * 2 ** (completedAttempts - 1), retry.maxDelayMs);
}

function wait(milliseconds: number, signal: AbortSignal | undefined) {
  if (milliseconds === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }

    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function wasAborted(signal: AbortSignal | undefined) {
  return signal?.aborted === true;
}

/** Creates a stateless, SSR-safe client for the public v1 customer API. */
export function createRespondKitClient(options: RespondKitClientOptions): RespondKitClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const baseHeaders = options.headers ?? {};
  const acceptanceRetry = normalizeRetryOptions(options.acceptanceRetry);

  async function request<T>(input: {
    readonly path: string;
    readonly method: "GET" | "POST";
    readonly responseSchema: RuntimeSchema<T>;
    readonly body?: string | undefined;
    readonly token?: SessionToken | undefined;
    readonly signal?: AbortSignal | undefined;
  }): Promise<T> {
    const fetchImplementation = resolveFetch(options.fetch);
    let response: Response;
    try {
      response = await fetchImplementation(`${baseUrl}${input.path}`, {
        method: input.method,
        headers: authorizationHeaders(baseHeaders, input.token),
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (cause) {
      if (wasAborted(input.signal)) throw cause;
      throw new RespondKitClientError("Unable to reach RespondKit", {
        code: "unavailable",
        retryable: true,
        cause,
      });
    }
    const body = await responseJson(response);

    if (!response.ok) throw serverError(response, body);
    return parseSuccess(input.responseSchema, response, body);
  }

  return {
    async createSession(input, requestOptions) {
      const body = JSON.stringify(CreateClientSessionRequestV1Schema.parse(input));
      return request({
        path: `/${API_VERSION}/client/sessions`,
        method: "POST",
        responseSchema: CreateClientSessionResponseV1Schema,
        body,
        signal: requestOptions?.signal,
      });
    },

    async createThread(sessionToken, input, requestOptions) {
      const token = SessionTokenSchema.parse(sessionToken);
      const immutableInput = CreateThreadRequestV1Schema.parse(input);
      const body = JSON.stringify(immutableInput);
      const response = await request({
        path: `/${API_VERSION}/threads`,
        method: "POST",
        responseSchema: CreateThreadResponseV1Schema,
        token,
        body,
        signal: requestOptions?.signal,
      });
      if (response.thread.clientThreadId !== immutableInput.clientThreadId) {
        throw new RespondKitClientError(
          "RespondKit returned a response for a different client thread",
          { code: "internal_error", retryable: false },
        );
      }
      return response;
    },

    async listMessages(sessionToken, threadId, query = {}, requestOptions) {
      const token = SessionTokenSchema.parse(sessionToken);
      const parsedThreadId = ThreadIdSchema.parse(threadId);
      const parsedQuery = ListMessagesQueryV1Schema.parse(query);
      const search = new URLSearchParams();
      if (parsedQuery.after !== undefined) search.set("after", parsedQuery.after);
      if (parsedQuery.limit !== undefined) search.set("limit", String(parsedQuery.limit));
      const queryString = search.size === 0 ? "" : `?${search.toString()}`;

      const page = await request({
        path: `/${API_VERSION}/threads/${encodeURIComponent(parsedThreadId)}/messages${queryString}`,
        method: "GET",
        responseSchema: ListMessagesResponseV1Schema,
        token,
        signal: requestOptions?.signal,
      });
      if (page.threadId !== parsedThreadId) {
        throw new RespondKitClientError(
          "RespondKit returned messages for a different support thread",
          { code: "internal_error", retryable: false },
        );
      }
      return page;
    },

    async sendMessage(sessionToken, threadId, input, requestOptions) {
      const token = SessionTokenSchema.parse(sessionToken);
      const parsedThreadId = ThreadIdSchema.parse(threadId);
      const immutableInput = SendMessageRequestV1Schema.parse(input);
      // Serialize once: every ambiguous retry sends the exact same payload, not
      // merely the same client_message_id attached to potentially edited text.
      const body = JSON.stringify(immutableInput);
      const path = `/${API_VERSION}/threads/${encodeURIComponent(parsedThreadId)}/messages`;
      const fetchImplementation = resolveFetch(options.fetch);
      let lastCause: unknown;

      for (let attempt = 1; attempt <= acceptanceRetry.attempts; attempt += 1) {
        let response: Response;
        try {
          response = await fetchImplementation(`${baseUrl}${path}`, {
            method: "POST",
            headers: authorizationHeaders(baseHeaders, token),
            body,
            ...(requestOptions?.signal === undefined ? {} : { signal: requestOptions.signal }),
          });
        } catch (cause) {
          if (wasAborted(requestOptions?.signal)) throw cause;
          lastCause = cause;
          if (attempt === acceptanceRetry.attempts) break;
          await wait(retryDelay(acceptanceRetry, attempt), requestOptions?.signal);
          continue;
        }

        if (!response.ok) {
          let responseBody: unknown;
          try {
            responseBody = await responseJson(response);
          } catch (cause) {
            if (wasAborted(requestOptions?.signal)) throw cause;

            const error = serverError(response, undefined);
            if (!shouldRetryStatus(response.status) && !error.retryable) throw error;

            lastCause = cause;
            if (attempt === acceptanceRetry.attempts) break;
            await wait(retryDelay(acceptanceRetry, attempt, response), requestOptions?.signal);
            continue;
          }

          const error = serverError(response, responseBody);
          if (!shouldRetryStatus(response.status) && !error.retryable) throw error;

          lastCause = error;
          if (attempt === acceptanceRetry.attempts) break;
          await wait(retryDelay(acceptanceRetry, attempt, response), requestOptions?.signal);
          continue;
        }

        let responseBody: unknown;
        try {
          responseBody = await responseJson(response);
        } catch (cause) {
          if (wasAborted(requestOptions?.signal)) throw cause;
          lastCause = cause;
          if (attempt === acceptanceRetry.attempts) break;
          await wait(retryDelay(acceptanceRetry, attempt, response), requestOptions?.signal);
          continue;
        }

        const acceptance = SendMessageResponseV1Schema.safeParse(responseBody);
        if (acceptance.success) {
          if (acceptance.data.acceptance.clientMessageId !== immutableInput.clientMessageId) {
            throw new RespondKitClientError(
              "RespondKit returned a response for a different client message",
              {
                code: "internal_error",
                status: response.status,
                retryable: false,
                clientMessageId: immutableInput.clientMessageId,
              },
            );
          }
          if (
            acceptance.data.acceptance.message !== undefined &&
            acceptance.data.acceptance.message.threadId !== parsedThreadId
          ) {
            throw new RespondKitClientError(
              "RespondKit returned a message from a different support thread",
              {
                code: "internal_error",
                status: response.status,
                retryable: false,
                clientMessageId: immutableInput.clientMessageId,
              },
            );
          }

          if (
            acceptance.data.acceptance.status !== "acceptance_unknown" ||
            attempt === acceptanceRetry.attempts
          ) {
            return acceptance.data;
          }

          await wait(retryDelay(acceptanceRetry, attempt, response), requestOptions?.signal);
          continue;
        }

        lastCause = new RespondKitClientError("RespondKit returned an invalid protocol response", {
          code: "internal_error",
          status: response.status,
          retryable: true,
          cause: acceptance.error,
          clientMessageId: immutableInput.clientMessageId,
        });
        if (attempt === acceptanceRetry.attempts) break;
        await wait(retryDelay(acceptanceRetry, attempt, response), requestOptions?.signal);
      }

      throw new RespondKitClientError(
        "Message acceptance is unknown; retry the same immutable message request",
        {
          code: "acceptance_unknown",
          retryable: true,
          clientMessageId: immutableInput.clientMessageId,
          cause: lastCause,
        },
      );
    },
  };
}
