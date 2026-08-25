import type { MessageWorkflowEnvelope } from "./workflows/envelope";

export interface Env {
  readonly DB: D1Database;
  readonly MESSAGE_WORKFLOW: Workflow<MessageWorkflowEnvelope>;
  readonly ENVIRONMENT: string;
  readonly GEMINI_MODEL: string;
  readonly DISCORD_API_BASE_URL: string;
  readonly GEMINI_API_KEY: string;
  readonly DISCORD_BOT_TOKEN: string;
  readonly DISCORD_APPLICATION_ID: string;
  readonly DISCORD_PUBLIC_KEY: string;
  readonly SESSION_SIGNING_KEY: string;
  readonly SESSION_TTL_SECONDS?: string;
}
