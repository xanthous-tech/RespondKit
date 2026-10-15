import { readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { compileXCStrings } from "@respondkit/paraglide-ios";
import { compileAndroidResources } from "@respondkit/paraglide-android";

const repo = resolve(import.meta.dirname, "..");
const root = resolve(repo, "localization");
const settings = JSON.parse(
  await readFile(resolve(root, "project.inlang/settings.json"), "utf8"),
) as { baseLocale: string; locales: string[] };
if (
  !Array.isArray(settings.locales) ||
  new Set(settings.locales).size !== settings.locales.length ||
  settings.locales.some((locale) => !/^[a-zA-Z0-9-]+$/.test(locale))
) {
  throw new Error("Expected unique locale names in project.inlang/settings.json");
}
const input = {
  sourceLocale: settings.baseLocale,
  catalogs: Object.fromEntries(
    await Promise.all(
      settings.locales.map(async (locale) => [
        locale,
        JSON.parse(await readFile(resolve(root, `messages/${locale}.json`), "utf8")),
      ]),
    ),
  ),
};
// Complete validation/compilation before changing any output files.
const files: Record<string, string> = {
  "native/swift/Sources/RespondKitUI/Resources/RespondKit.xcstrings": compileXCStrings(input),
};
for (const [path, content] of Object.entries(compileAndroidResources(input)))
  files[`localization/generated/android/res/${path}`] = content;
async function existingFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return (
    await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? existingFiles(resolve(directory, entry.name))
          : [relative(repo, resolve(directory, entry.name))],
      ),
    )
  ).flat();
}
const existing = await existingFiles(resolve(root, "generated"));
if (process.argv.includes("--check")) {
  const stale = existing.filter((path) => !(path in files));
  for (const [path, content] of Object.entries(files)) {
    const actual = await readFile(resolve(repo, path), "utf8").catch(() => undefined);
    if (actual !== content) stale.push(path);
  }
  if (stale.length)
    throw new Error(
      `Stale localization resources: ${stale.join(", ")}. Run pnpm localization:generate.`,
    );
  console.log("Native localization resources match the shared JSON catalogs.");
} else {
  for (const path of existing.filter((path) => !(path in files))) await rm(resolve(repo, path));
  for (const [path, content] of Object.entries(files)) {
    const destination = resolve(repo, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  console.log(`Generated ${Object.keys(files).length} native resource files.`);
}
