import type { InboxId, InstallationId, VisitorId, WorkspaceId } from "@agent-chat/protocol";
import { and, eq, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import type { VisitorContext } from "./config";
import { normalizeOrigin } from "./config";
import { allowedOrigins, inboxes, products, visitors, workspaces, type VisitorRow } from "./schema";

export interface InboxContext {
  readonly workspaceId: WorkspaceId;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
  readonly productId: string;
  readonly productSlug: string;
  readonly productName: string;
  readonly inboxId: InboxId;
  readonly inboxName: string;
  readonly defaultLocale: string | null;
}

export interface UpsertVisitorInput extends VisitorContext {
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly observedAt: Date;
}

export class VisitorIdentityConflictError extends Error {
  override readonly name = "VisitorIdentityConflictError";

  constructor(visitorId: VisitorId) {
    super(`Visitor ${visitorId} is already assigned to another inbox`);
  }
}

/** Resolves the public inbox selector embedded by the customer widget. */
export async function findInboxByPublicId(
  db: DrizzleD1Database,
  inboxId: InboxId,
): Promise<InboxContext | null> {
  const [result] = await db
    .select({
      workspaceId: workspaces.id,
      workspaceSlug: workspaces.slug,
      workspaceName: workspaces.name,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      inboxId: inboxes.id,
      inboxName: inboxes.name,
      defaultLocale: inboxes.defaultLocale,
    })
    .from(inboxes)
    .innerJoin(
      products,
      and(eq(products.id, inboxes.productId), eq(products.workspaceId, inboxes.workspaceId)),
    )
    .innerJoin(workspaces, eq(workspaces.id, inboxes.workspaceId))
    .where(
      and(eq(inboxes.id, inboxId), eq(inboxes.status, "active"), eq(workspaces.status, "active")),
    )
    .limit(1);

  return result ?? null;
}

export async function findInboxById(
  db: DrizzleD1Database,
  workspaceId: WorkspaceId,
  inboxId: InboxId,
): Promise<InboxContext | null> {
  const [result] = await db
    .select({
      workspaceId: workspaces.id,
      workspaceSlug: workspaces.slug,
      workspaceName: workspaces.name,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      inboxId: inboxes.id,
      inboxName: inboxes.name,
      defaultLocale: inboxes.defaultLocale,
    })
    .from(inboxes)
    .innerJoin(
      products,
      and(eq(products.id, inboxes.productId), eq(products.workspaceId, inboxes.workspaceId)),
    )
    .innerJoin(workspaces, eq(workspaces.id, inboxes.workspaceId))
    .where(
      and(
        eq(inboxes.id, inboxId),
        eq(inboxes.workspaceId, workspaceId),
        eq(inboxes.status, "active"),
        eq(workspaces.status, "active"),
      ),
    )
    .limit(1);

  return result ?? null;
}

export async function isOriginAllowed(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly origin: string;
  },
): Promise<boolean> {
  let origin: string;

  try {
    origin = normalizeOrigin(input.origin);
  } catch {
    return false;
  }

  const [match] = await db
    .select({ id: allowedOrigins.id })
    .from(allowedOrigins)
    .where(
      and(
        eq(allowedOrigins.workspaceId, input.workspaceId),
        eq(allowedOrigins.inboxId, input.inboxId),
        eq(allowedOrigins.origin, origin),
      ),
    )
    .limit(1);

  return match !== undefined;
}

export async function findVisitorById(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly visitorId: VisitorId;
  },
): Promise<VisitorRow | null> {
  const [visitor] = await db
    .select()
    .from(visitors)
    .where(
      and(
        eq(visitors.id, input.visitorId),
        eq(visitors.workspaceId, input.workspaceId),
        eq(visitors.inboxId, input.inboxId),
      ),
    )
    .limit(1);

  return visitor ?? null;
}

export async function findVisitorByInstallationId(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly installationId: InstallationId;
  },
): Promise<VisitorRow | null> {
  const [visitor] = await db
    .select()
    .from(visitors)
    .where(
      and(
        eq(visitors.workspaceId, input.workspaceId),
        eq(visitors.inboxId, input.inboxId),
        eq(visitors.installationId, input.installationId),
      ),
    )
    .limit(1);

  return visitor ?? null;
}

export async function upsertVisitor(
  db: DrizzleD1Database,
  input: UpsertVisitorInput,
): Promise<VisitorRow> {
  const update = {
    updatedAt: input.observedAt,
    lastSeenAt: input.observedAt,
    ...(input.externalUserId !== undefined && {
      externalUserId: input.externalUserId,
    }),
    ...(input.email !== undefined && { email: input.email }),
    ...(input.posthogDistinctId !== undefined && {
      posthogDistinctId: input.posthogDistinctId,
    }),
    ...(input.locale !== undefined && { locale: input.locale }),
    ...(input.timezone !== undefined && { timezone: input.timezone }),
    ...(input.region !== undefined && { region: input.region }),
    ...(input.userAgent !== undefined && { userAgent: input.userAgent }),
    ...(input.metadata !== undefined && { metadata: input.metadata }),
  };

  const identityMatch = input.externalUserId
    ? or(
        eq(visitors.id, input.id),
        eq(visitors.installationId, input.installationId),
        eq(visitors.externalUserId, input.externalUserId),
      )
    : or(eq(visitors.id, input.id), eq(visitors.installationId, input.installationId));

  await db.batch([
    db
      .insert(visitors)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        inboxId: input.inboxId,
        installationId: input.installationId,
        externalUserId: input.externalUserId,
        email: input.email,
        posthogDistinctId: input.posthogDistinctId,
        locale: input.locale,
        timezone: input.timezone,
        region: input.region,
        userAgent: input.userAgent,
        metadata: input.metadata ?? {},
        createdAt: input.observedAt,
        updatedAt: input.observedAt,
        lastSeenAt: input.observedAt,
      })
      .onConflictDoNothing(),
    db
      .update(visitors)
      .set(update)
      .where(
        and(
          eq(visitors.workspaceId, input.workspaceId),
          eq(visitors.inboxId, input.inboxId),
          identityMatch,
        ),
      ),
  ]);

  const [visitor] = await db
    .select()
    .from(visitors)
    .where(
      and(
        eq(visitors.workspaceId, input.workspaceId),
        eq(visitors.inboxId, input.inboxId),
        identityMatch,
      ),
    )
    .limit(1);

  if (!visitor) {
    throw new VisitorIdentityConflictError(input.id);
  }

  return visitor;
}
