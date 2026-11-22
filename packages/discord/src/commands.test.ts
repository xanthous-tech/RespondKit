import { describe, expect, it } from "vite-plus/test";

import {
  DISCORD_ACTIVITY_COMMAND,
  DISCORD_GUILD_COMMANDS,
  DISCORD_REPLY_COMMAND,
  DISCORD_TRANSLATE_MESSAGE_COMMAND,
} from "./commands";

describe("Discord guild commands", () => {
  it("registers only reply, Translate to English, and activity", () => {
    expect(DISCORD_GUILD_COMMANDS).toEqual([
      DISCORD_REPLY_COMMAND,
      DISCORD_TRANSLATE_MESSAGE_COMMAND,
      DISCORD_ACTIVITY_COMMAND,
    ]);
    expect(DISCORD_GUILD_COMMANDS.map((command) => command.name)).toEqual([
      "reply",
      "Translate to English",
      "activity",
    ]);
    expect(
      DISCORD_GUILD_COMMANDS.every((command) => command.default_member_permissions === "0"),
    ).toBe(true);
  });

  it("accepts one free-form reply up to 6000 characters with optional translate", () => {
    expect(DISCORD_REPLY_COMMAND.options[0]).toEqual(
      expect.objectContaining({
        name: "message",
        type: 3,
        required: true,
        min_length: 1,
        max_length: 6_000,
      }),
    );
    expect(DISCORD_REPLY_COMMAND.options[1]).toMatchObject({ name: "translate", required: false });
  });
});
