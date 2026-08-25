import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vite-plus/test";

import { allowedOrigins, inboxes, products, visitors, workspaces } from "./schema";

describe("workspace D1 schema", () => {
  it("owns the complete non-secret customer topology", () => {
    expect(
      [workspaces, products, inboxes, allowedOrigins, visitors].map(
        (table) => getTableConfig(table).name,
      ),
    ).toEqual(["workspace", "product", "inbox", "allowed_origin", "visitor"]);
  });

  it("uses scoped foreign keys for every workspace-owned child", () => {
    expect(getTableConfig(products).foreignKeys).toHaveLength(1);
    expect(getTableConfig(inboxes).foreignKeys).toHaveLength(1);
    expect(getTableConfig(allowedOrigins).foreignKeys).toHaveLength(1);
    expect(getTableConfig(visitors).foreignKeys).toHaveLength(1);
  });

  it("does not store runtime provider secrets", () => {
    const columns = [workspaces, products, inboxes, allowedOrigins, visitors]
      .flatMap((table) => getTableConfig(table).columns)
      .map((column) => column.name);

    expect(columns).not.toContain("discord_bot_token");
    expect(columns).not.toContain("gemini_api_key");
    expect(columns).not.toContain("widget_signing_key");
  });

  it("stores the browser profile installation on the visitor, not the inbox", () => {
    const inboxColumns = getTableConfig(inboxes).columns.map((column) => column.name);
    const visitorColumns = getTableConfig(visitors).columns.map((column) => column.name);

    expect(inboxColumns).not.toContain("installation_id");
    expect(visitorColumns).toContain("installation_id");
  });
});
