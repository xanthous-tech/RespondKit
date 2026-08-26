import { drizzle } from "drizzle-orm/d1";

export type RespondKitDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(binding: D1Database) {
  return drizzle(binding);
}
