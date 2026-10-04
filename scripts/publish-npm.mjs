import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { lookupNpmPackage, planNpmRelease } from "./lib/npm-release.mjs";

const [mode, directory = "artifacts/npm", tag = process.env.RELEASE_TAG] = process.argv.slice(2);
if (!["--check", "--publish"].includes(mode) || !/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
  throw new Error(
    "Usage: node scripts/publish-npm.mjs --check|--publish <tarball-directory> v0.6.0",
  );
}
const version = tag.slice(1);
const artifacts = [];
for (const name of ["protocol", "api-client", "react", "react-native"]) {
  const tarball = resolve(directory, `respondkit-${name}-${version}.tgz`);
  const integrity = `sha512-${createHash("sha512")
    .update(await readFile(tarball))
    .digest("base64")}`;
  artifacts.push({ name: `@respondkit/${name}`, tarball, integrity });
}
const plan = await planNpmRelease({ version, artifacts, lookup: lookupNpmPackage });
for (const item of plan) console.log(`${item.action}: ${item.name}@${version}`);
if (mode === "--publish") {
  for (const item of plan) {
    if (item.action === "skip") continue;
    // The source repo requires pnpm; run npm outside it while retaining the CI OIDC environment.
    execFileSync("npm", ["publish", item.tarball, "--access", "public"], {
      cwd: tmpdir(),
      stdio: "inherit",
    });
  }
}
