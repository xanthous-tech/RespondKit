import fixture from "../../../native/fixtures/protocol.json";
import { describe, expect, it } from "vite-plus/test";
import {
  CreateClientSessionResponseV1Schema,
  ListThreadStatusesResponseV1Schema,
  ListMessagesResponseV1Schema,
  SendMessageResponseV1Schema,
} from "./customer";
import { ApiErrorResponseV1Schema } from "./errors";

describe("shared native contract fixtures", () => {
  it("matches the canonical v1 schemas", () => {
    expect(CreateClientSessionResponseV1Schema.safeParse(fixture.session).success).toBe(true);
    expect(ListThreadStatusesResponseV1Schema.safeParse(fixture.statuses).success).toBe(true);
    expect(ListMessagesResponseV1Schema.safeParse(fixture.messages).success).toBe(true);
    expect(SendMessageResponseV1Schema.safeParse(fixture.acceptance).success).toBe(true);
    expect(ApiErrorResponseV1Schema.safeParse(fixture.error).success).toBe(true);
  });
});
