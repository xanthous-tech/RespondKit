import { beforeEach, expect, it } from "vite-plus/test";
import { createHttpApp } from "./http";
import { createTestEnv, seedTopology, TEST_ORIGIN, TEST_TOPOLOGY } from "../test/fixtures";

beforeEach(() => seedTopology());
it("stores native model and OS separately from the transport User-Agent", async () => {
  const env = createTestEnv();
  const device = {
    platform: "ios",
    model: "iPhone17,3",
    osVersion: "26.0.1",
    appVersion: "1.2",
    sdk: "swift",
  };
  const response = await createHttpApp().request(
    "/v1/client/sessions",
    {
      method: "POST",
      headers: {
        origin: TEST_ORIGIN,
        "content-type": "application/json",
        "user-agent": "CFNetwork/1",
      },
      body: JSON.stringify({
        inboxId: TEST_TOPOLOGY.inboxId,
        installationId: "install_native_device",
        context: { device },
      }),
    },
    env,
  );
  expect(response.status).toBe(201);
  const visitor = await env.DB.prepare("SELECT device, user_agent FROM visitor").first<{
    device: string;
    user_agent: string;
  }>();
  expect(JSON.parse(visitor!.device)).toEqual(device);
  expect(visitor!.user_agent).toBe("CFNetwork/1");
});
it("rejects unbounded or unsupported native device payloads", async () => {
  const response = await createHttpApp().request(
    "/v1/client/sessions",
    {
      method: "POST",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        inboxId: TEST_TOPOLOGY.inboxId,
        installationId: "install_bad_device",
        context: {
          device: { platform: "ios", model: "a".repeat(129), osVersion: "26", serial: "secret" },
        },
      }),
    },
    createTestEnv(),
  );
  expect(response.status).toBe(400);
});
