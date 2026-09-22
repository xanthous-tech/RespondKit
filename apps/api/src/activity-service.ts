import { z } from "zod";
import type { ParsedDiscordActivityInteraction } from "@respondkit/discord";
import type { Env } from "./env";

export class ActivityError extends Error {}

const connectionSchema = z.object({
  host: z.enum(["https://eu.posthog.com", "https://us.posthog.com"]),
  projectId: z.number().int().positive(),
  endpoint: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  version: z.number().int().positive(),
});
export type ActivityConnection = z.infer<typeof connectionSchema>;
export interface ActivityEvent {
  id: string;
  timestamp: number;
  event: string;
  path: string;
  details: string;
}
export interface ActivityResult {
  events: ActivityEvent[];
  truncated: boolean;
  start: number;
  end: number;
  count: number;
  kind: string;
}

export function activityConnection(env: Env, inboxId: string): ActivityConnection {
  let connections: Record<string, unknown>;
  try {
    connections = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(env.POSTHOG_ACTIVITY_INBOXES ?? "{}"));
  } catch {
    throw new ActivityError(
      "PostHog activity configuration is invalid. Ask the server administrator to check it.",
    );
  }
  if (!Object.hasOwn(connections, inboxId))
    throw new ActivityError("PostHog activity is not configured for this inbox.");
  const parsed = connectionSchema.safeParse(connections[inboxId]);
  if (!parsed.success)
    throw new ActivityError("PostHog activity configuration is invalid for this inbox.");
  return parsed.data;
}

/** Strip markup, mentions, control characters and links from analytics-provided text. */
export function activityText(value: string, limit = 160): string {
  return Array.from(
    value
      .replace(/[\p{Cc}\p{Cf}]/gu, " ")
      .replace(/[`*_~|<>[\]\\]/g, "")
      .replaceAll("@", "＠")
      .replace(/https?:\/\//gi, ""),
  )
    .slice(0, limit)
    .join("");
}

export async function fetchActivity(input: {
  connection: ActivityConnection;
  apiKey: string;
  distinctId: string;
  options: Pick<ParsedDiscordActivityInteraction, "count" | "minutes" | "activityKind">;
  end: number;
}): Promise<ActivityResult> {
  const { count, minutes, activityKind } = input.options;
  if (!input.distinctId.trim() || input.distinctId.length > 512)
    throw new ActivityError(
      "This customer has no valid PostHog distinct ID. The host app must supply one.",
    );
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100 ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 10080 ||
    !["all", "pageviews", "events"].includes(activityKind)
  )
    throw new ActivityError(
      "Use count 1–100, minutes 1–10080, and kind all, pageviews, or events.",
    );
  if (!Number.isFinite(input.end) || input.end < 0)
    throw new ActivityError("The activity time window is invalid.");
  const end = Math.floor(input.end / 1000) * 1000;
  const start = end - minutes * 60_000;
  const utc = (value: number) => new Date(value).toISOString().slice(0, 19).replace("T", " ");
  let response: Response;
  try {
    response = await fetch(
      `${input.connection.host}/api/projects/${input.connection.projectId}/endpoints/${input.connection.endpoint}/run/`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({
          version: input.connection.version,
          refresh: "force",
          variables: {
            respondkit_distinct_id: input.distinctId,
            respondkit_start_time: utc(start),
            respondkit_end_time: utc(end),
            respondkit_event_kind: activityKind,
            respondkit_row_limit: count + 1,
          },
        }),
      },
    );
  } catch {
    throw new ActivityError("PostHog did not respond in time. Run /activity again to retry.");
  }
  if (!response.ok) {
    const guidance =
      response.status === 401 || response.status === 403
        ? "Check the configured key's project and endpoint:read permission."
        : response.status === 429
          ? "PostHog is rate limited; try again shortly."
          : "Try again or check the saved PostHog endpoint.";
    throw new ActivityError(`PostHog activity failed (HTTP ${response.status}). ${guidance}`);
  }
  // Do not log provider bodies: they may contain credentials or unrelated analytics data.
  try {
    const text = await response.text();
    if (text.length > 256_000) throw new Error();
    const data = z
      .object({
        columns: z.array(z.string()).max(30),
        results: z.array(z.array(z.unknown())).max(101),
        endpoint_version: z.number().optional(),
      })
      .parse(JSON.parse(text));
    if (data.endpoint_version !== undefined && data.endpoint_version !== input.connection.version)
      throw new Error();
    const names = [
      "uuid",
      "timestamp",
      "event",
      "distinct_id",
      "page_path",
      "surface",
      "app_version",
      "error_code",
      "error_type",
      "input_type",
      "pipeline_mode",
    ];
    if (
      names.some((name) => !data.columns.includes(name)) ||
      new Set(data.columns).size !== data.columns.length
    )
      throw new Error();
    const events: ActivityEvent[] = [];
    const seen = new Set<string>();
    for (const row of data.results) {
      if (row.length !== data.columns.length) throw new Error();
      const get = (name: string): string => {
        const value = row[data.columns.indexOf(name)];
        if (value === null) return "";
        if (typeof value !== "string") throw new Error();
        return value;
      };
      const timestamp = Date.parse(get("timestamp"));
      const event = get("event");
      if (
        get("distinct_id") !== input.distinctId ||
        !Number.isFinite(timestamp) ||
        timestamp < start ||
        timestamp > end ||
        !event
      )
        throw new Error();
      const allowedSystemEvents =
        activityKind === "pageviews"
          ? ["$pageview"]
          : activityKind === "events"
            ? ["$exception", "$rageclick"]
            : ["$pageview", "$pageleave", "$screen", "$exception", "$rageclick"];
      if (
        (event.startsWith("$") && !allowedSystemEvents.includes(event)) ||
        (activityKind === "pageviews" && event !== "$pageview")
      )
        throw new Error();
      const id = get("uuid");
      if (!id) throw new Error();
      if (seen.has(id)) continue;
      seen.add(id);
      const path = get("page_path").split(/[?#]/, 1)[0] ?? "";
      events.push({
        id,
        timestamp,
        event: activityText(event, 100),
        path: activityText(path, 180),
        details: names
          .slice(5)
          .map((name) => {
            const value = get(name);
            return value ? `${name}: ${activityText(value, 60)}` : "";
          })
          .filter(Boolean)
          .join(" · "),
      });
    }
    events.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
    return {
      events: events.slice(0, count).reverse(),
      truncated: data.results.length > count,
      start,
      end,
      count,
      kind: activityKind,
    };
  } catch {
    throw new ActivityError(
      "PostHog returned unexpected activity data. No activity was posted; check the endpoint configuration.",
    );
  }
}

export function formatActivity(
  result: ActivityResult,
  distinctId: string,
  timezone: string | null,
  projectUrl: string,
) {
  let zone = timezone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone }).format();
  } catch {
    zone = "UTC";
  }
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const header = `**Customer activity · ${result.events.length} events · ${result.kind}**\n${date.format(result.start)} → ${date.format(result.end)} (${zone})\nPostHog ID: ${activityText(distinctId, 256)} · browser-reported\n${result.truncated ? `Showing the latest ${result.count}; more events exist in this window.` : "All matching events returned for this window."}\n`;
  const lines = result.events.map(
    (event) =>
      `${date.format(event.timestamp)}  ${event.event}${event.path ? `  ${event.path}` : ""}${event.details ? `\n  ${event.details}` : ""}`,
  );
  const footer = `\nPostHog: <${projectUrl}>\nSnapshot as of the window end. Recently captured events may still be arriving.`;
  const full = `${header}\n${lines.length ? lines.join("\n") : "No matching activity found. This does not prove the customer was inactive."}${footer}`;
  if (full.length <= 1900) return { content: full };
  let preview = header;
  let shown = 0;
  for (const line of lines) {
    if (shown === 5 || preview.length + line.length > 1450) break;
    preview += `\n${line}`;
    shown++;
  }
  return {
    content: `${preview}\n\nFull timeline (${result.events.length} events) attached.${footer}`,
    file: full.replaceAll("**", ""),
  };
}
