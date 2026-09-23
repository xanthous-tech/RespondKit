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
  const timeout = AbortSignal.timeout(12_000);
  const timedOut = (error: unknown) =>
    timeout.aborted || (error instanceof DOMException && error.name === "TimeoutError");
  let response: Response;
  try {
    response = await fetch(
      `${input.connection.host}/api/projects/${input.connection.projectId}/endpoints/${input.connection.endpoint}/run/`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
        // workerd supports manual/follow only. Reject 3xx below without forwarding credentials.
        redirect: "manual",
        signal: timeout,
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
  } catch (error) {
    const isTimeout = timedOut(error);
    console.warn("posthog_activity_request_failed", {
      reason: isTimeout ? "timeout" : "request_failed",
    });
    throw new ActivityError(
      isTimeout
        ? "PostHog did not respond in time. Run /activity again to retry."
        : "The server could not send the PostHog request. Run /activity again; if it persists, ask the server administrator to check the connection.",
    );
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
      events: events.slice(0, count),
      truncated: data.results.length > count,
      start,
      end,
      count,
      kind: activityKind,
    };
  } catch (error) {
    if (timedOut(error))
      throw new ActivityError("PostHog did not respond in time. Run /activity again to retry.");
    throw new ActivityError(
      "PostHog returned unexpected activity data. No activity was posted; check the endpoint configuration.",
    );
  }
}

/** PostHog's Activity scene accepts a DataTableNode in the URL's q fragment. */
export function activityUrl(
  connection: ActivityConnection,
  result: ActivityResult,
  distinctId: string,
): string {
  // Match PostHog's HogQL string escaping; identity is data, never an expression.
  const escapes: Record<string, string> = {
    "\\": "\\\\",
    "'": "\\'",
    "\b": "\\b",
    "\f": "\\f",
    "\r": "\\r",
    "\n": "\\n",
    "\t": "\\t",
    "\0": "\\0",
    "\x07": "\\a",
    "\v": "\\v",
  };
  const literal = (value: string) => `'${Array.from(value, (c) => escapes[c] ?? c).join("")}'`;
  const kinds =
    result.kind === "pageviews"
      ? "event = '$pageview'"
      : result.kind === "events"
        ? "not startsWith(event, '$') OR event IN ('$exception', '$rageclick')"
        : "not startsWith(event, '$') OR event IN ('$pageview', '$pageleave', '$screen', '$exception', '$rageclick')";
  const query = {
    kind: "DataTableNode",
    source: {
      kind: "EventsQuery",
      select: ["*", "event", "timestamp", "properties.$current_url", "distinct_id"],
      where: [
        `distinct_id = ${literal(distinctId)}`,
        `timestamp >= toDateTime(${result.start / 1000}) AND timestamp <= toDateTime(${result.end / 1000})`,
        `(${kinds})`,
      ],
      // EventsQuery's after/before are exclusive; the predicates above preserve our inclusive bounds.
      after: new Date(result.start - 1000).toISOString(),
      before: new Date(result.end + 1000).toISOString(),
      orderBy: ["timestamp DESC", "uuid DESC"],
      limit: result.count,
      filterTestAccounts: false,
    },
  };
  return `${connection.host}/project/${connection.projectId}/activity/explore#q=${encodeURIComponent(JSON.stringify(query))}`;
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
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const stamp = (value: number) => `${day.format(value)} ${time.format(value)}`;
  const title = `Customer activity · ${result.events.length} ${result.kind === "pageviews" ? "pageviews" : "events"}`;
  const header = `${stamp(result.start)} → ${stamp(result.end)}\n${result.truncated ? `Latest ${result.count} · more matching events available\n` : ""}`;
  let previousDay = "";
  const lines = result.events.map((event) => {
    const date = day.format(event.timestamp);
    const heading = date !== previousDay ? `\n**${date}**\n` : "";
    previousDay = date;
    const label = result.kind === "pageviews" ? "" : ` **${event.event}**`;
    return `${heading}\`${time.format(event.timestamp)}\`${label}${event.path ? `  \`${event.path}\`` : ""}${event.details ? `\n${event.details}` : ""}`;
  });
  const timeline = lines.length ? lines.join("\n") : "\nNo matching activity found.";
  // Keep unusually long encoded identities out of Discord's embed URL field.
  const linkFits = projectUrl.length <= 2048;
  const full = `${title}\n${header}${zone}\nPostHog ID: ${activityText(distinctId, 512)}\n${timeline}\n\nPostHog: ${projectUrl}`;
  const needsFile = header.length + timeline.length > 3800 || !linkFits;
  const preview: string[] = [];
  for (const line of lines) {
    if (preview.length === 5 || preview.join("\n").length + line.length > 3500) break;
    preview.push(line);
  }
  const description = needsFile
    ? `${header}${preview.join("\n")}\n\nFull activity (${result.events.length} events) attached.${!linkFits ? " PostHog link included in attachment." : ""}`
    : `${header}${timeline}`;
  return {
    embeds: [
      {
        title: `${title}${linkFits ? " ↗" : ""}`,
        ...(linkFits ? { url: projectUrl } : {}),
        description,
        color: 0x5865f2,
        footer: { text: `${zone} · Newest first${linkFits ? " · Open title in PostHog" : ""}` },
      },
    ],
    ...(needsFile ? { file: full.replaceAll("**", "").replaceAll("`", "") } : {}),
  };
}
