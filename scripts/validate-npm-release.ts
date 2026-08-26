import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const packageDirectories = ["packages/protocol", "packages/api-client", "packages/react"] as const;
const releaseTag = process.argv[2];

if (releaseTag === undefined || !/^v\d+\.\d+\.\d+$/.test(releaseTag)) {
  throw new Error("Pass a semver release tag such as v0.1.0");
}

const releaseVersion = releaseTag.slice(1);
try {
  await access(resolve(workspaceRoot, "LICENSE"));
} catch {
  throw new Error("Add a root LICENSE file before publishing RespondKit");
}

for (const packageDirectory of packageDirectories) {
  const manifest = JSON.parse(
    await readFile(resolve(workspaceRoot, packageDirectory, "package.json"), "utf8"),
  ) as { license?: string; name?: string; version?: string };

  if (manifest.version !== releaseVersion) {
    throw new Error(`${manifest.name ?? packageDirectory} is not version ${releaseVersion}`);
  }
  if (manifest.license === undefined || manifest.license === "UNLICENSED") {
    throw new Error(
      `${manifest.name ?? packageDirectory} needs a public license before publishing`,
    );
  }
}

console.log(`RespondKit npm release ${releaseTag} has consistent versions and license metadata.`);
