import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          GEMINI_API_KEY: "test-only",
          DISCORD_BOT_TOKEN: "test-only",
          DISCORD_APPLICATION_ID: "100000000000000002",
          DISCORD_PUBLIC_KEY: "00".repeat(32),
          SESSION_SIGNING_KEY: "test-only-session-signing-key",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
  define: {
    __D1_MIGRATIONS__: JSON.stringify(await readD1Migrations("./migrations")),
  },
}));
