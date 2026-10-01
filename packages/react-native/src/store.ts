import {
  createRespondKitClient,
  RespondKitClientError,
  type RespondKitClient,
  type ClientSessionV1,
  type CustomerContextV1,
  type MessageV1,
  type ThreadV1,
} from "@respondkit/api-client";
import { CursorSchema, MessageV1Schema, ThreadV1Schema } from "@respondkit/protocol";
import { z } from "zod";

export interface RespondKitPersistence {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
}
/** Supply a host storage driver, using a separate key for each API URL and inbox. */
export function storagePersistence(
  storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<unknown>;
  },
  key: string,
): RespondKitPersistence {
  return {
    load: () => storage.getItem(key),
    save: async (value) => {
      await storage.setItem(key, value);
    },
  };
}
export function memoryPersistence(): RespondKitPersistence {
  let value: string | null = null;
  return {
    load: () => Promise.resolve(value),
    save: (data) => {
      value = data;
      return Promise.resolve();
    },
  };
}
const pendingSchema = z.object({
  id: z.string(),
  text: z.string(),
  acceptedAt: z.string(),
  delivery: z.enum(["sending", "acceptance_unknown", "accepted", "failed"]),
});
export type PendingMessage = z.infer<typeof pendingSchema>;
const storedSchema = z.object({
  version: z.literal(1),
  userId: z.string().optional(),
  installationId: z.string(),
  newThreadId: z.string(),
  selected: z.string().optional(),
  startingNew: z.boolean(),
  threads: z.array(z.object({ thread: ThreadV1Schema, latestReplyCursor: CursorSchema })),
  messages: z.record(z.string(), z.array(MessageV1Schema)),
  cursors: z.record(z.string(), CursorSchema),
  read: z.record(z.string(), CursorSchema),
  pendingReads: z.record(z.string(), CursorSchema),
  drafts: z.record(z.string(), z.string()),
  pending: z.record(z.string(), z.array(pendingSchema)),
});
type Stored = z.infer<typeof storedSchema>;
export interface SupportSnapshot {
  readonly threads: readonly ThreadV1[];
  readonly unreadThreadIds: ReadonlySet<string>;
  readonly activeThread: ThreadV1 | undefined;
  readonly messages: readonly MessageV1[];
  readonly pending: readonly PendingMessage[];
  readonly draft: string;
  readonly cursor: string;
  readonly loading: boolean;
  readonly sending: boolean;
  readonly error: string | undefined;
  readonly email: string | undefined;
  readonly fresh: boolean;
}
export interface StoreOptions {
  readonly apiBaseUrl: string;
  readonly inboxId: string;
  /** A configured allowed origin, sent explicitly by native clients. */
  readonly origin: string;
  readonly persistence: RespondKitPersistence;
  readonly context?: CustomerContextV1;
  readonly getIdentityToken?: (() => Promise<string | null>) | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly pollIntervalMs?: number;
  /** Use a cryptographically secure opaque ID generator. The native entry point supplies one. */
  readonly createId: (prefix: string) => string;
  readonly client?: RespondKitClient;
}

function freshState(options: StoreOptions, userId?: string): Stored {
  return {
    version: 1,
    ...(userId ? { userId } : {}),
    installationId: options.createId("install"),
    newThreadId: options.createId("cthread"),
    startingNew: false,
    threads: [],
    messages: {},
    cursors: {},
    read: {},
    pendingReads: {},
    drafts: {},
    pending: {},
  };
}

/** Retain one store above your support screen. Session tokens stay in memory. */
export class RespondKitStore {
  private data: Stored;
  private context: CustomerContextV1;
  private getIdentityToken: StoreOptions["getIdentityToken"];
  private readonly client: RespondKitClient;
  private session: ClientSessionV1 | undefined;
  private epoch = 0;
  private listeners = new Set<() => void>();
  private snapshot!: SupportSnapshot;
  private tasks: Promise<unknown> = Promise.resolve();
  private writes: Promise<unknown> = Promise.resolve();
  private poll: ReturnType<typeof setTimeout> | undefined;
  private foreground = false;
  private pollEpoch = 0;
  private visible = false;
  private loadedHistory = false;
  private freshThreads = new Set<string>();
  private loading = false;
  private sending = false;
  private error: string | undefined;
  private refreshTask: Promise<void> | undefined;

  private constructor(
    private readonly options: StoreOptions,
    data: Stored,
  ) {
    this.data = data;
    this.context = options.context ?? {};
    this.getIdentityToken = options.getIdentityToken;
    this.client =
      options.client ??
      createRespondKitClient({
        baseUrl: options.apiBaseUrl,
        fetch: options.fetch,
        headers: { Origin: options.origin },
      });
    this.loadedHistory = data.threads.length > 0;
    this.publish();
  }
  static async create(options: StoreOptions): Promise<RespondKitStore> {
    const origin = new URL(options.origin);
    const base = new URL(options.apiBaseUrl);
    if (
      base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(base.hostname)
      )
    )
      throw new Error("HTTPS is required outside local development");
    if (base.username || base.password || base.search || base.hash)
      throw new Error("Invalid support API URL");
    if (
      !["https:", "http:"].includes(origin.protocol) ||
      origin.origin !== options.origin ||
      (options.pollIntervalMs ?? 10_000) < 1_000
    )
      throw new Error("Invalid support configuration");
    const raw = await options.persistence.load();
    let data =
      raw === null
        ? freshState(options, options.context?.userId)
        : storedSchema.parse(JSON.parse(raw));
    if (data.userId !== options.context?.userId)
      data = freshState(options, options.context?.userId);
    for (const messages of Object.values(data.pending))
      for (const message of messages) {
        if (message.delivery === "sending") message.delivery = "acceptance_unknown";
      }
    await options.persistence.save(JSON.stringify(data));
    return new RespondKitStore(options, data);
  }
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = () => this.snapshot;

  private publish() {
    const key = this.data.selected ?? "new";
    const unread = new Set(
      this.data.threads
        .filter((s) => Number(s.latestReplyCursor) > Number(this.data.read[s.thread.id] ?? "0"))
        .map((s) => s.thread.id),
    );
    this.snapshot = {
      threads: this.data.threads.map((s) => s.thread),
      unreadThreadIds: unread,
      activeThread: this.data.threads.find((s) => s.thread.id === this.data.selected)?.thread,
      messages: this.data.messages[key] ?? [],
      pending: this.data.pending[key] ?? [],
      draft: this.data.drafts[key] ?? "",
      cursor: this.data.cursors[key] ?? "0",
      loading: this.loading,
      sending: this.sending,
      error: this.error,
      email: this.context.email,
      fresh:
        this.loadedHistory && (!this.data.selected || this.freshThreads.has(this.data.selected)),
    };
    for (const listener of this.listeners) listener();
  }
  private persist(): Promise<void> {
    const raw = JSON.stringify(this.data);
    const write = this.writes.catch(() => undefined).then(() => this.options.persistence.save(raw));
    this.writes = write;
    return write;
  }
  private check(epoch: number) {
    if (epoch !== this.epoch) throw new Error("Support identity changed");
  }
  private run(operation: (epoch: number) => Promise<void>, busy = true): Promise<void> {
    const epoch = this.epoch;
    const task = this.tasks
      .catch(() => undefined)
      .then(async () => {
        if (epoch !== this.epoch) return;
        this.loading = busy;
        this.publish();
        try {
          await operation(epoch);
          this.check(epoch);
          this.error = undefined;
        } catch (error) {
          if (epoch === this.epoch)
            this.error = error instanceof Error ? error.message : "Support request failed.";
        } finally {
          if (epoch === this.epoch) {
            this.loading = false;
            this.publish();
          }
        }
      });
    this.tasks = task;
    return task;
  }
  private async token(epoch: number): Promise<string> {
    if (this.session && Date.parse(this.session.expiresAt) > Date.now() + 15_000)
      return this.session.token;
    const identityToken = await this.getIdentityToken?.();
    this.check(epoch);
    if (this.getIdentityToken && !identityToken)
      throw new Error("Support identity could not be verified.");
    const result = await this.client.createSession({
      inboxId: this.options.inboxId,
      installationId: this.data.installationId,
      context: this.context,
      ...(identityToken ? { identityToken } : {}),
    });
    this.check(epoch);
    this.session = result.session;
    if (!this.context.email) {
      const contact = await this.client
        .getContact(result.session.token)
        .catch(() => ({}) as { email?: string });
      this.check(epoch);
      if (contact.email) this.context = { ...this.context, email: contact.email };
    }
    return result.session.token;
  }
  private async authorized<T>(epoch: number, action: (token: string) => Promise<T>): Promise<T> {
    try {
      const result = await action(await this.token(epoch));
      this.check(epoch);
      return result;
    } catch (error) {
      this.check(epoch);
      if (!(error instanceof RespondKitClientError) || error.status !== 401) throw error;
      this.session = undefined;
      const result = await action(await this.token(epoch));
      this.check(epoch);
      return result;
    }
  }
  setForeground(active: boolean) {
    if (this.foreground === active) return;
    this.foreground = active;
    const pollEpoch = ++this.pollEpoch;
    clearTimeout(this.poll);
    if (active) {
      const tick = async () => {
        if (!this.foreground || pollEpoch !== this.pollEpoch) return;
        await this.refresh();
        if (this.foreground && pollEpoch === this.pollEpoch)
          this.poll = setTimeout(() => void tick(), this.options.pollIntervalMs ?? 10_000);
      };
      void tick();
    }
  }
  dispose() {
    this.setForeground(false);
    this.epoch++;
    this.listeners.clear();
  }
  async openConversation() {
    this.visible = true;
    await this.refresh();
  }
  closeConversation() {
    this.visible = false;
  }
  async selectThread(id?: string) {
    if (id && !this.data.threads.some((s) => s.thread.id === id)) return;
    this.data.selected = id;
    this.data.startingNew = !id;
    this.publish();
    await this.run(async () => {
      await this.persist();
    }, false);
    if (this.visible) await this.refresh();
  }
  setDraft(text: string) {
    this.data.drafts[this.data.selected ?? "new"] = text;
    this.publish();
    return this.persist().catch((error) => {
      this.error = String(error);
      this.publish();
    });
  }
  updateIdentity(
    context: CustomerContextV1,
    getIdentityToken?: StoreOptions["getIdentityToken"],
  ): Promise<void> {
    const previous = this.session;
    const changed = this.context.userId !== context.userId;
    this.epoch++;
    this.context = {
      ...context,
      ...(context.device || this.context.device
        ? { device: context.device ?? this.context.device! }
        : {}),
    };
    this.getIdentityToken = getIdentityToken;
    this.session = undefined;
    this.loading = false;
    this.sending = false;
    this.error = undefined;
    if (changed) {
      this.data = freshState(this.options, context.userId);
      this.freshThreads.clear();
      this.loadedHistory = false;
    }
    this.publish();
    return this.run(async () => {
      await this.persist();
      if (changed && previous) await this.client.logout(previous.token);
    }, false);
  }
  refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    const task = this.run(
      async (epoch) => {
        const statuses: Stored["threads"] = [];
        let after: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await this.authorized(epoch, (token) =>
            this.client.listThreadStatuses(token, after),
          );
          statuses.push(...page.threads);
          after = page.nextCursor;
          if (after && seen.has(after)) throw new Error("Repeated support history cursor");
          if (after) seen.add(after);
        } while (after);
        this.data.threads = [...new Map(statuses.map((s) => [s.thread.id, s])).values()].sort(
          (a, b) => b.thread.updatedAt.localeCompare(a.thread.updatedAt),
        );
        this.loadedHistory = true;
        if (!this.data.startingNew && !statuses.some((s) => s.thread.id === this.data.selected))
          this.data.selected = this.data.threads[0]?.thread.id;
        await this.persist();
        this.check(epoch);
        this.publish();
        if (this.visible && this.data.selected) await this.loadMessages(this.data.selected, epoch);
        await this.flushReads(epoch);
      },
      !this.loadedHistory ||
        (this.visible &&
          !!this.data.selected &&
          this.data.cursors[this.data.selected] === undefined),
    );
    this.refreshTask = task;
    void task.finally(() => {
      if (this.refreshTask === task) this.refreshTask = undefined;
    });
    return task;
  }
  private merge(threadId: string, incoming: readonly MessageV1[]) {
    const messages = new Map((this.data.messages[threadId] ?? []).map((m) => [m.id, m]));
    for (const message of incoming) messages.set(message.id, message);
    this.data.messages[threadId] = [...messages.values()].sort(
      (a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.id.localeCompare(b.id),
    );
    const confirmed = new Set(
      incoming.filter((m) => m.state !== "failed").map((m) => m.clientMessageId),
    );
    this.data.pending[threadId] = (this.data.pending[threadId] ?? []).filter(
      (m) => !confirmed.has(m.id),
    );
  }
  private async loadMessages(threadId: string, epoch: number) {
    let more = true;
    while (more) {
      const after = this.data.cursors[threadId] ?? "0";
      const page = await this.authorized(epoch, (token) =>
        this.client.listMessages(token, threadId, { after, limit: 100 }),
      );
      if (page.hasMore && Number(page.nextCursor) <= Number(after))
        throw new Error("Support transcript did not advance");
      this.merge(threadId, page.messages);
      this.data.cursors[threadId] = page.nextCursor;
      more = page.hasMore;
      await this.persist();
      this.check(epoch);
      this.publish();
    }
  }
  sendDraft(): Promise<void> {
    const text = this.snapshot.draft.trim();
    if (
      !text ||
      text.length > 6_000 ||
      this.sending ||
      this.snapshot.activeThread?.state === "closed"
    )
      return Promise.resolve();
    this.sending = true;
    const key = this.data.selected ?? "new";
    const pending: PendingMessage = {
      id: this.options.createId("cmsg"),
      text,
      acceptedAt: new Date().toISOString(),
      delivery: "sending",
    };
    this.data.pending[key] = [...(this.data.pending[key] ?? []), pending];
    this.data.drafts[key] = "";
    this.publish();
    const epoch = this.epoch;
    return this.run(async (current) => {
      await this.persist();
      this.check(current);
      await this.deliver(pending, key, current);
    }, false).finally(() => {
      if (epoch === this.epoch) {
        // A local storage failure can stop the operation before deliver() begins.
        for (const [threadKey, messages] of Object.entries(this.data.pending)) {
          const unsent = messages.find(
            (message) => message.id === pending.id && message.delivery === "sending",
          );
          if (unsent) this.replacePending(threadKey, { ...unsent, delivery: "failed" });
        }
        this.sending = false;
        this.publish();
      }
    });
  }
  retry(id: string): Promise<void> {
    if (this.sending) return Promise.resolve();
    const key = this.data.selected ?? "new";
    let pending = this.data.pending[key]?.find((m) => m.id === id);
    if (!pending) {
      const failed = this.data.messages[key]?.find(
        (m) => m.clientMessageId === id && m.state === "failed",
      );
      if (failed)
        pending = { id, text: failed.text, acceptedAt: failed.acceptedAt, delivery: "failed" };
    }
    if (!pending) return Promise.resolve();
    const payload = pending;
    this.sending = true;
    this.publish();
    const epoch = this.epoch;
    return this.run((current) => this.deliver(payload, key, current), false).finally(() => {
      if (epoch === this.epoch) {
        this.sending = false;
        this.publish();
      }
    });
  }
  private async deliver(pending: PendingMessage, key: string, epoch: number) {
    let threadId = key;
    try {
      if (key === "new") {
        const created = await this.authorized(epoch, (token) =>
          this.client.createThread(token, { clientThreadId: this.data.newThreadId }),
        );
        threadId = created.thread.id;
        this.data.threads = [
          { thread: created.thread, latestReplyCursor: "0" },
          ...this.data.threads.filter((s) => s.thread.id !== threadId),
        ];
        this.data.pending[threadId] = this.data.pending.new ?? [pending];
        delete this.data.pending.new;
        this.data.drafts[threadId] = this.data.drafts.new ?? "";
        delete this.data.drafts.new;
        this.data.selected = threadId;
        this.data.startingNew = false;
        this.freshThreads.add(threadId);
        this.data.newThreadId = this.options.createId("cthread");
        await this.persist();
        this.check(epoch);
        this.publish();
      }
      this.replacePending(threadId, { ...pending, delivery: "sending" });
      await this.persist();
      this.check(epoch);
      const { acceptance } = await this.authorized(epoch, (token) =>
        this.client.sendMessage(token, threadId, {
          clientMessageId: pending.id,
          text: pending.text,
        }),
      );
      this.replacePending(threadId, {
        ...pending,
        delivery:
          acceptance.status === "acceptance_unknown"
            ? "acceptance_unknown"
            : acceptance.status === "failed"
              ? "failed"
              : "accepted",
      });
      if (acceptance.message) this.merge(threadId, [acceptance.message]);
      await this.persist();
      this.check(epoch);
      this.publish();
    } catch (error) {
      this.check(epoch);
      this.replacePending(threadId, {
        ...pending,
        delivery:
          error instanceof RespondKitClientError &&
          error.code !== "acceptance_unknown" &&
          !error.retryable
            ? "failed"
            : "acceptance_unknown",
      });
      await this.persist();
      this.check(epoch);
      throw error;
    }
  }
  private replacePending(key: string, message: PendingMessage) {
    this.data.pending[key] = [
      ...(this.data.pending[key] ?? []).filter((m) => m.id !== message.id),
      message,
    ];
  }
  saveEmail(email: string): Promise<void> {
    return this.run(async (epoch) => {
      const contact = await this.authorized(epoch, (token) =>
        this.client.saveContact(token, {
          email: email.trim(),
          ...(this.data.selected ? { threadId: this.data.selected } : {}),
        }),
      );
      this.context = { ...this.context, ...(contact.email ? { email: contact.email } : {}) };
    });
  }
  markDisplayed(threadId: string, cursor: string): Promise<void> {
    if (
      !this.visible ||
      !this.foreground ||
      this.data.selected !== threadId ||
      CursorSchema.safeParse(cursor).success === false ||
      Number(cursor) > Number(this.data.cursors[threadId] ?? "0")
    )
      return Promise.resolve();
    if (Number(cursor) <= Number(this.data.read[threadId] ?? "0")) return Promise.resolve();
    this.data.read[threadId] = cursor;
    this.data.pendingReads[threadId] = cursor;
    this.publish();
    return this.run(async (epoch) => {
      await this.persist();
      this.check(epoch);
      await this.flushReads(epoch);
    }, false);
  }
  private async flushReads(epoch: number) {
    for (const [threadId, cursor] of Object.entries(this.data.pendingReads)) {
      await this.authorized(epoch, (token) =>
        this.client.markThreadRead(token, threadId, { cursor }),
      );
      if (this.data.pendingReads[threadId] === cursor) delete this.data.pendingReads[threadId];
      await this.persist();
      this.check(epoch);
    }
  }
}
