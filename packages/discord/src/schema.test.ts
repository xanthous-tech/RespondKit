import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vite-plus/test";

import {
  discordIntegrations,
  discordInteractions,
  discordMessages,
  discordOperatorAllowlists,
  discordThreads,
} from "./schema";

describe("Discord D1 schema", () => {
  it("owns the complete Discord integration topology", () => {
    expect(
      [
        discordIntegrations,
        discordOperatorAllowlists,
        discordThreads,
        discordMessages,
        discordInteractions,
      ].map((table) => getTableConfig(table).name),
    ).toEqual([
      "discord_integration",
      "discord_operator_allowlist",
      "discord_thread",
      "discord_message",
      "discord_interaction",
    ]);
  });

  it("never gives the short-lived Discord interaction token a storage column", () => {
    expect(getTableConfig(discordInteractions).columns.map((column) => column.name)).not.toContain(
      "token",
    );
  });

  it("declares scoped foreign keys for every product-owned mapping", () => {
    expect(getTableConfig(discordIntegrations).foreignKeys).toHaveLength(1);
    expect(getTableConfig(discordOperatorAllowlists).foreignKeys).toHaveLength(1);
    expect(getTableConfig(discordThreads).foreignKeys).toHaveLength(2);
    expect(getTableConfig(discordMessages).foreignKeys).toHaveLength(2);
    expect(getTableConfig(discordInteractions).foreignKeys).toHaveLength(4);
  });
});
