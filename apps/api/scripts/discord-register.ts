/// <reference types="node" />

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DISCORD_GUILD_COMMANDS } from "@agent-chat/discord";

import { collectDiscordCommandTargets, loadTopologyConfiguration } from "./topology";

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = resolve(apiDirectory, "config/workspaces.local.json");
const discordApiBaseUrl = "https://discord.com/api/v10";

interface RegisterOptions {
  readonly configPath: string;
  readonly dryRun: boolean;
}

function parseOptions(): RegisterOptions {
  const { values } = parseArgs({
    options: {
      config: { type: "string", short: "c" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  return {
    configPath: resolve(values.config ?? defaultConfigPath),
    dryRun: values["dry-run"],
  };
}

function printHelp(): void {
  console.log(`Bulk-overwrite Agent Chat's guild-scoped Discord commands.

Usage:
  vp exec tsx scripts/discord-register.ts [options]

Options:
  -c, --config <path>       Topology JSON (default: config/workspaces.local.json)
      --dry-run             Validate and print requests without contacting Discord
  -h, --help                Show this help

Live registration reads DISCORD_BOT_TOKEN from the process environment.
`);
}

async function registerGuildCommands(
  applicationId: string,
  guildId: string,
  token: string,
): Promise<void> {
  const endpoint = `${discordApiBaseUrl}/applications/${applicationId}/guilds/${guildId}/commands`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
      "user-agent": "Agent Chat command setup",
    },
    body: JSON.stringify(DISCORD_GUILD_COMMANDS),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2_000);
    throw new Error(
      `Discord rejected command registration for guild ${guildId} (${response.status}): ${detail}`,
    );
  }

  console.log(`Registered ${DISCORD_GUILD_COMMANDS.length} commands in guild ${guildId}.`);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const configuration = await loadTopologyConfiguration(options.configPath);
  const targets = collectDiscordCommandTargets(configuration);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          requests: targets.map((target) => ({
            method: "PUT",
            url: `${discordApiBaseUrl}/applications/${target.applicationId}/guilds/${target.guildId}/commands`,
          })),
          commands: DISCORD_GUILD_COMMANDS,
        },
        undefined,
        2,
      ),
    );
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (token === undefined || token.trim() === "") {
    throw new Error(
      "DISCORD_BOT_TOKEN is required for live registration. Use a separately provisioned development bot token or pass --dry-run.",
    );
  }

  for (const target of targets) {
    await registerGuildCommands(target.applicationId, target.guildId, token);
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
