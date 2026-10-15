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
const key = /^respondkit[_-][a-z0-9_-]*$/;
// Exception messages are diagnostics: stores and pickers present catalog text instead.
const diagnostic = /((Exception|Error)\(|\b(check|require)\([^)]*\)\s*\{)\s*$/;
const uiArgument =
  /(\b(Text|Button|Label|TextField|SecureField|Toggle|Link|Menu|Section|navigationTitle|accessibilityLabel|accessibilityHint|accessibilityValue|help)\(|\b(contentDescription|placeholder|label|title)\s*=\s*|\bIcon\((?:[^()]|\([^()]*\))*,)\s*$/;
const copy = [
  /^[A-Z][a-z]+(?:[\s.,!?…]|$)/,
  /[A-Za-z]{2,} [A-Za-z]{2,}/,
  /(\\\(|\$\{?)[^"]*\s[A-Za-z]{2,}/,
  /[A-Za-z]{2,}\s[^"]*(\\\(|\$)/,
];

async function sources(directory, extension) {
  const entries = await readdir(resolve(repo, directory), { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => relative(repo, join(entry.parentPath, entry.name)));
}

export function englishLiterals(source) {
  const found = [];
  for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    const text = match[1];
    if (!/[A-Za-z]/.test(text) || key.test(text) || allowed.has(text)) continue;
    const before = source.slice(source.lastIndexOf("\n", match.index) + 1, match.index);
    if (diagnostic.test(before)) continue;
    if (uiArgument.test(before) || copy.some((pattern) => pattern.test(text))) found.push(text);
  }
  return found;
}

await test("the guard catches labels, statuses, placeholders and interpolated text", () => {
  assert.deepEqual(
    englishLiterals(
      [
        'Text("Save email")',
        'Text("retry")',
        'Button("OK")',
        'Icon(painterResource(R.drawable.respondkit_send), "send")',
        '.accessibilityLabel("close")',
        'label = { Text("email") }',
        '"sending" -> "Sending…"',
        'status: message.state == "failed" ? "Failed" : "Sent"',
        'Label("\\(unseen) new", systemImage: "arrow.down")',
        'Text("$unseen new", fontSize = 14.sp)',
      ].join("\n"),
    ),
    [
      "Save email",
      "retry",
      "OK",
      "send",
      "close",
      "email",
      "Sending…",
      "Failed",
      "Sent",
      "\\(unseen) new",
      "$unseen new",
    ],
  );
});

await test("the guard ignores catalog keys, tags, wire values and diagnostics", () => {
  assert.deepEqual(
    englishLiterals(
      [
        'Text("respondkit_help", tableName: "RespondKit", bundle: .module)',
        '.accessibilityIdentifier("respondkit-close")',
        'message.direction == "customer_to_operator"',
        'Image(systemName: "paperplane")',
        'File(context.cacheDir, "respondkit-${item.id}")',
        'throw RespondKitException("Support storage is damaged.")',
        'check(bytes.size > 12) { "Support storage is damaged." }',
        'TextField("you@example.com", text: $email)',
      ].join("\n"),
    ),
    [],
  );
});

await test("native SDK UI modules read every user-visible string from the catalog", async () => {
  const found = [];
  for (const [directory, extension] of views)
    for (const path of await sources(directory, extension))
      for (const literal of englishLiterals(await readFile(resolve(repo, path), "utf8")))
        found.push(`${path}: "${literal}"`);
  assert.deepEqual(found, [], "Move these strings into localization/messages/en.json");
});
