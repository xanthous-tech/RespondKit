import { createHttpApp } from "./http";
import type { Env } from "./env";
import { syncDiscordReadReceipts } from "./read-receipts";

export { TranslationWorkflow } from "./workflows/translation";

export { MessageWorkflow } from "./workflows/message";

const app = createHttpApp();

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env) {
    await syncDiscordReadReceipts(env);
  },
};
