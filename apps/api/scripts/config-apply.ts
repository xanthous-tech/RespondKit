/// <reference types="node" />

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";

import { buildTopologySeedSql, listPublicInboxIds, loadTopologyConfiguration } from "./topology";

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = resolve(apiDirectory, "config/workspaces.local.json");

interface ApplyOptions {
  readonly configPath: string;
  readonly database: string;
  readonly dryRun: boolean;
  readonly environment: string | undefined;
  readonly remote: boolean;
}

function parseOptions(): ApplyOptions {
  const { values } = parseArgs({
    options: {
      config: { type: "string", short: "c" },
      database: { type: "string", default: "agent-chat" },
      "dry-run": { type: "boolean", default: false },
      env: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      local: { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.local && values.remote) {
    throw new Error("Choose either --local or --remote, not both");
  }

  const remote = values.remote || (values.env !== undefined && !values.local);
  return {
    configPath: resolve(values.config ?? defaultConfigPath),
    database: values.database,
    dryRun: values["dry-run"],
    environment: values.env,
    remote,
  };
}

function printHelp(): void {
  console.log(`Apply the non-secret Agent Chat topology to D1.

Usage:
  vp exec tsx scripts/config-apply.ts [options]

Options:
  -c, --config <path>    Topology JSON (default: config/workspaces.local.json)
      --database <name>  D1 database name (default: agent-chat)
      --local            Apply to Wrangler's local D1 database (default)
      --remote           Apply to a remote D1 database
      --env <name>       Wrangler environment; implies --remote unless --local is set
      --dry-run          Validate and print seed SQL without invoking Wrangler
  -h, --help             Show this help
`);
}

async function runWrangler(arguments_: readonly string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("vp", ["exec", "wrangler", ...arguments_], {
      cwd: apiDirectory,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(
        new Error(
          signal === null
            ? `Wrangler exited with status ${String(code)}`
            : `Wrangler was terminated by ${signal}`,
        ),
      );
    });
  });
}

function targetArguments(options: ApplyOptions): readonly string[] {
  const arguments_ = [options.remote ? "--remote" : "--local"];
  if (options.environment !== undefined) arguments_.push("--env", options.environment);
  return arguments_;
}

async function main(): Promise<void> {
  const options = parseOptions();
  const configuration = await loadTopologyConfiguration(options.configPath);
  const seedSql = buildTopologySeedSql(configuration);

  if (options.dryRun) {
    console.log(seedSql);
    printPublicInboxIds(configuration, "Validated");
    return;
  }

  const target = targetArguments(options);
  console.log(
    `Applying migrations to ${options.remote ? "remote" : "local"} D1 database ${options.database}...`,
  );
  await runWrangler(["d1", "migrations", "apply", options.database, ...target]);

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "agent-chat-config-"));
  const seedPath = join(temporaryDirectory, "topology.sql");

  try {
    await writeFile(seedPath, seedSql, { encoding: "utf8", mode: 0o600 });
    console.log("Applying idempotent topology configuration...");
    await runWrangler(["d1", "execute", options.database, ...target, "--file", seedPath]);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }

  printPublicInboxIds(configuration, "Applied");
}

function printPublicInboxIds(
  configuration: Awaited<ReturnType<typeof loadTopologyConfiguration>>,
  verb: string,
): void {
  console.log(
    `${verb} topology. Public widget inbox ID${listPublicInboxIds(configuration).length === 1 ? "" : "s"}:`,
  );
  for (const inboxId of listPublicInboxIds(configuration)) console.log(`  ${inboxId}`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
