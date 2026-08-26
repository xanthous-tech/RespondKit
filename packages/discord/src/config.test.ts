import { describe, expect, it } from "vite-plus/test";

import { discordIntegrationConfigurationSchema } from "./config";

describe("discordIntegrationConfigurationSchema", () => {
  it("normalizes a key-free integration topology", () => {
    expect(
      discordIntegrationConfigurationSchema.parse({
        id: "example-discord",
        applicationId: "100000000000000001",
        guildId: "100000000000000002",
        forumChannelId: "100000000000000003",
        operators: {
          userIds: ["100000000000000005", "100000000000000004", "100000000000000004"],
          roleIds: [],
        },
      }),
    ).toMatchObject({
      operators: {
        userIds: ["100000000000000004", "100000000000000005"],
        roleIds: [],
      },
    });
  });

  it("requires at least one operator and valid Discord snowflakes", () => {
    const base = {
      id: "example-discord",
      applicationId: "100000000000000001",
      guildId: "100000000000000002",
      forumChannelId: "100000000000000003",
      operators: { userIds: [], roleIds: [] },
    };
    expect(discordIntegrationConfigurationSchema.safeParse(base).success).toBe(false);
    expect(
      discordIntegrationConfigurationSchema.safeParse({
        ...base,
        applicationId: "not-a-snowflake",
        operators: { userIds: ["100000000000000004"], roleIds: [] },
      }).success,
    ).toBe(false);
  });
});
