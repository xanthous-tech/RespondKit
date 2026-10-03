import { beforeEach, expect, it } from "vite-plus/test";
import { createHttpApp } from "./http";
import { createCustomerFixture, createTestEnv, seedTopology, TEST_ORIGIN } from "../test/fixtures";

beforeEach(() => seedTopology());
it("saves validated contact data and restores it without creating a message", async () => {
  const customer = await createCustomerFixture();
  const app = createHttpApp();
  const env = createTestEnv();
  const headers = {
    origin: TEST_ORIGIN,
    authorization: `Bearer ${customer.sessionToken}`,
    "content-type": "application/json",
  };
  const saved = await app.request(
    "/v1/client/contact",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "  new@example.com  ", threadId: customer.threadId }),
    },
    env,
  );
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ email: "new@example.com" });
  const restored = await app.request("/v1/client/contact", { headers }, env);
  expect(await restored.json()).toEqual({ email: "new@example.com" });
  expect(await env.DB.prepare("SELECT count(*) AS count FROM message").first()).toEqual({
    count: 0,
  });
  const invalid = await app.request(
    "/v1/client/contact",
    { method: "POST", headers, body: JSON.stringify({ email: "not-an-email" }) },
    env,
  );
  expect(invalid.status).toBe(400);
});
it("requires authentication and refuses contact changes for another visitor's thread", async () => {
  const app = createHttpApp();
  const env = createTestEnv();
  const [a, b] = await Promise.all([createCustomerFixture(), createCustomerFixture()]);
  expect((await app.request("/v1/client/contact", {}, env)).status).toBe(401);
  const response = await app.request(
    "/v1/client/contact",
    {
      method: "POST",
      headers: {
        origin: TEST_ORIGIN,
        authorization: `Bearer ${a.sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "thief@example.com", threadId: b.threadId }),
    },
    env,
  );
  expect(response.status).toBe(404);
});
