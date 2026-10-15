import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

const repo = resolve(import.meta.dirname, "..");
const views = [
  ["native/swift/Sources/RespondKitUI", ".swift"],
  ["native/android/compose/src/main/kotlin", ".kt"],
];
const allowed = new Set(["you@example.com"]);

async function sources(directory, extension) {
  const entries = await readdir(resolve(repo, directory), { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => relative(repo, join(entry.parentPath, entry.name)));
}

export function englishLiterals(source) {
  return [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)]
    .map((match) => match[1])
    .filter((text) => /^[A-Z][a-z]+(?:[\s.,!?…]|$)/.test(text) && !allowed.has(text));
}

await test("the guard catches labels, statuses and placeholders", () => {
  assert.deepEqual(
    englishLiterals(
      'Text("Save email") Icon(icon, "Send message") "sending" -> "Sending…" Button("respondkit_retry") "Content-Type"',
    ),
    ["Save email", "Send message", "Sending…"],
  );
});

await test("native SDK views read every user-visible string from the catalog", async () => {
  const found = [];
  for (const [directory, extension] of views)
    for (const path of await sources(directory, extension)) {
      const source = await readFile(resolve(repo, path), "utf8");
      if (!/^\s*import (SwiftUI|androidx\.compose\.)/m.test(source)) continue;
      for (const literal of englishLiterals(source)) found.push(`${path}: "${literal}"`);
    }
  assert.deepEqual(found, [], "Move these strings into localization/messages/en.json");
});
