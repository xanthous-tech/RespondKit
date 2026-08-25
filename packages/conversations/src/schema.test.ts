import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vite-plus/test";

import { customerTranscriptEntries, messageTranslations, messages, threads } from "./schema";

describe("conversation D1 schema", () => {
  it("uses the durable model names consumed by the migration ledger", () => {
    expect(
      [threads, messages, customerTranscriptEntries, messageTranslations].map(
        (table) => getTableConfig(table).name,
      ),
    ).toEqual(["thread", "message", "customer_transcript_entry", "message_translation"]);
  });

  it("uses append-only state revisions as the autoincrement polling cursor", () => {
    const config = getTableConfig(customerTranscriptEntries);
    const rowId = config.columns.find((column) => column.name === "row_id");

    expect(rowId).toMatchObject({
      primary: true,
      autoIncrement: true,
    });
    expect(config.columns.map((column) => column.name)).toEqual([
      "row_id",
      "workspace_id",
      "inbox_id",
      "thread_id",
      "message_id",
      "processing_generation",
      "event_kind",
      "event_at",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "customer_transcript_entry_revision_uq",
    );
  });

  it("enforces workspace-scoped parent relationships", () => {
    expect(getTableConfig(threads).foreignKeys).toHaveLength(2);
    expect(getTableConfig(messages).foreignKeys).toHaveLength(1);
    expect(getTableConfig(customerTranscriptEntries).foreignKeys).toHaveLength(1);
    expect(getTableConfig(messageTranslations).foreignKeys).toHaveLength(1);
  });
});
