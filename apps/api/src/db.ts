import { drizzle } from "drizzle-orm/d1";

export type AgentChatDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(binding: D1Database) {
  return drizzle(binding);
}
