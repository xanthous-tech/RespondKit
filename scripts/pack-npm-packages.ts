import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(workspaceRoot, "artifacts/npm");
const packageDirectories = ["packages/protocol", "packages/api-client", "packages/react"] as const;

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

for (const packageDirectory of packageDirectories) {
  execFileSync("pnpm", ["-C", packageDirectory, "pack", "--pack-destination", outputDirectory], {
    cwd: workspaceRoot,
    stdio: "inherit",
  });
}

console.log(`RespondKit npm tarballs are ready in ${outputDirectory}`);
