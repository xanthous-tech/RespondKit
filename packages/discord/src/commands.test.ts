import { describe, expect, it } from "vite-plus/test";

import {
  DISCORD_GUILD_COMMANDS,
  DISCORD_REPLY_COMMAND,
  DISCORD_RETRY_COMMAND,
  DISCORD_STATUS_COMMAND,
} from "./commands";

describe("Discord guild commands", () => {
  it("publishes the canonical recovery-safe command set", () => {
    expect(DISCORD_GUILD_COMMANDS.map((command) => command.name)).toEqual([
      "reply",
      "status",
      "retry",
    ]);
    expect(
      DISCORD_GUILD_COMMANDS.every((command) => command.default_member_permissions === "0"),
    ).toBe(true);
  });

  it("accepts one free-form English reply up to 6000 characters", () => {
    expect(DISCORD_REPLY_COMMAND.options).toEqual([
      expect.objectContaining({
        name: "message",
        type: 3,
        required: true,
        min_length: 1,
        max_length: 6_000,
      }),
    ]);
  });

  it("keeps status read-only and retry bound to the original payload", () => {
    expect(DISCORD_STATUS_COMMAND.options.map((option) => option.name)).toEqual(["reference"]);
    expect(DISCORD_RETRY_COMMAND.options.map((option) => option.name)).toEqual([
      "reference",
      "message",
    ]);
  });
});
