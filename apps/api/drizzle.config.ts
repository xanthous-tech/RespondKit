import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "../../packages/workspaces/src/schema.ts",
    "../../packages/conversations/src/schema.ts",
    "../../packages/discord/src/schema.ts",
  ],
  out: "./migrations",
});
