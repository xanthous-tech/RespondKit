import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vite-plus/test";

import { messageTranslations, messages, threads } from "./schema";

describe("conversation D1 schema", () => {
  it("uses the durable model names consumed by the migration ledger", () => {
    expect(
      [threads, messages, messageTranslations].map((table) => getTableConfig(table).name),
    ).toEqual(["thread", "message", "message_translation"]);
  });

  it("makes the committed message row the autoincrement polling cursor", () => {
    const rowId = getTableConfig(messages).columns.find((column) => column.name === "row_id");

    expect(rowId).toMatchObject({
      primary: true,
      autoIncrement: true,
    });
  });

  it("enforces workspace-scoped parent relationships", () => {
    expect(getTableConfig(threads).foreignKeys).toHaveLength(2);
    expect(getTableConfig(messages).foreignKeys).toHaveLength(1);
    expect(getTableConfig(messageTranslations).foreignKeys).toHaveLength(1);
  });
});
