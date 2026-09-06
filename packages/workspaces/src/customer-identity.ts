import type { CustomerContextV1, InboxId, VisitorId, WorkspaceId } from "@respondkit/protocol";
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { customers, visitorAliases, visitorCustomers, visitors } from "./schema";

export async function findVisitorCustomer(db: DrizzleD1Database, visitorId: VisitorId) {
  const [link] = await db
    .select({
      visitorId: visitorCustomers.visitorId,
      customerId: visitorCustomers.customerId,
      userId: customers.userId,
      workspaceId: visitorCustomers.workspaceId,
      inboxId: visitorCustomers.inboxId,
    })
    .from(visitorCustomers)
    .innerJoin(customers, eq(customers.id, visitorCustomers.customerId))
    .where(eq(visitorCustomers.visitorId, visitorId))
    .limit(1);
  return link ?? null;
}

export async function linkVisitorCustomer(
  db: DrizzleD1Database,
  input: {
    workspaceId: WorkspaceId;
    inboxId: InboxId;
    visitorId: VisitorId;
    userId: string;
  },
) {
  const now = new Date();
  // Deterministic, framed IDs make concurrent first logins converge on one account.
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([input.workspaceId, input.inboxId, input.userId])),
    ),
  );
  const customerId = `customer_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  await db.batch([
    db
      .insert(customers)
      .values({
        id: customerId,
        workspaceId: input.workspaceId,
        inboxId: input.inboxId,
        userId: input.userId,
        createdAt: now,
      })
      .onConflictDoNothing(),
    db
      .insert(visitorCustomers)
      .values({
        visitorId: input.visitorId,
        customerId,
        workspaceId: input.workspaceId,
        inboxId: input.inboxId,
        linkedAt: now,
      })
      .onConflictDoNothing(),
  ]);
  const link = await findVisitorCustomer(db, input.visitorId);
  return link?.customerId === customerId ? link : null;
}

export async function recordVisitorAliases(
  db: DrizzleD1Database,
  visitorId: VisitorId,
  context: CustomerContextV1 | undefined,
) {
  const now = new Date();
  const aliases = [
    ["app_user_id", context?.userId],
    ["posthog_distinct_id", context?.posthogDistinctId],
    ["posthog_session_id", context?.posthogSessionId],
  ] as const;
  for (const [kind, value] of aliases) {
    if (value === undefined) continue;
    await db
      .insert(visitorAliases)
      .values({
        id: crypto.randomUUID(),
        visitorId,
        kind,
        value,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [visitorAliases.visitorId, visitorAliases.kind, visitorAliases.value],
        set: { lastSeenAt: now },
      });
  }
}

export async function revokeVisitorSessions(
  db: DrizzleD1Database,
  visitorId: VisitorId,
  sessionVersion: number,
) {
  await db
    .update(visitors)
    .set({ sessionVersion: sql`${visitors.sessionVersion} + 1` })
    .where(and(eq(visitors.id, visitorId), eq(visitors.sessionVersion, sessionVersion)));
}
