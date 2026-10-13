/// <reference types="node" />

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DiscordRestClient } from "@respondkit/discord";

import { loadTopologyConfiguration } from "./topology";

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = resolve(apiDirectory, "config/workspaces.local.json");

const { values } = parseArgs({
  options: {
    config: { type: "string", short: "c" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`Add each inbox's allowlisted operator users to the open posts of its Discord forum,
so their Discord apps notify them about every message in those posts. New posts get this
from the message workflow; this backfills posts that existed before.

Usage:
  vp exec tsx scripts/discord-join-operators.ts [--config <path>] [--dry-run]

Reads DISCORD_BOT_TOKEN from the process environment. Archived posts are skipped:
Discord cannot add members to an archived thread.
`);
  process.exit(0);
}

const configuration = await loadTopologyConfiguration(resolve(values.config ?? defaultConfigPath));
const token = process.env.DISCORD_BOT_TOKEN ?? "";
if (!values["dry-run"] && token === "") {
  console.error("DISCORD_BOT_TOKEN is required unless --dry-run is set");
  process.exit(1);
}
const client = new DiscordRestClient({ botToken: token || "dry-run" });

const threadsByGuild = new Map<
  string,
  Awaited<ReturnType<DiscordRestClient["listActiveGuildThreads"]>>
>();
let joined = 0;
let failed = 0;
for (const workspace of configuration.workspaces) {
  for (const product of workspace.products) {
    for (const inbox of product.inboxes) {
      const { guildId, forumChannelId, operators } = inbox.discord;
      if (operators.userIds.length === 0) continue;
      if (values["dry-run"]) {
        console.log(
          `${inbox.id}: would add ${operators.userIds.length} operator(s) to every active post in its forum`,
        );
        continue;
      }
      if (!threadsByGuild.has(guildId))
        threadsByGuild.set(guildId, await client.listActiveGuildThreads(guildId));
      const posts = threadsByGuild
        .get(guildId)!
        .filter((thread) => thread.parent_id === forumChannelId);
      let inboxJoined = 0;
      for (const post of posts) {
        for (const userId of operators.userIds) {
          try {
            await client.addThreadMember(post.id, userId);
            inboxJoined++;
          } catch (error) {
            failed++;
            console.warn(
              `${inbox.id}: could not add an operator to a post (${(error as { status?: number }).status ?? "error"})`,
            );
          }
        }
      }
      joined += inboxJoined;
      console.log(
        `${inbox.id}: ${posts.length} active post(s), ${inboxJoined} membership(s) added or confirmed`,
      );
    }
  }
}
console.log(`done: ${joined} added or confirmed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
