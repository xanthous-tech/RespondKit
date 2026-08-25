import { applyD1Migrations, env, reset, type D1Migration } from "cloudflare:test";
import { beforeEach } from "vite-plus/test";

declare const __D1_MIGRATIONS__: D1Migration[];

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, __D1_MIGRATIONS__);
});
