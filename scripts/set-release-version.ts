import { glob, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = process.argv[2];
if (version === undefined || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error("Pass a stable semantic version, such as 0.5.0");
}

for await (const path of glob(["package.json", "apps/*/package.json", "packages/*/package.json"], {
  cwd: root,
})) {
  const file = resolve(root, path);
  const manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.version = version;
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
}
await writeFile(resolve(root, "VERSION"), `${version}\n`);
console.log(
  `Set every RespondKit package to ${version}; Android reads VERSION and SwiftPM uses v${version}.`,
);
