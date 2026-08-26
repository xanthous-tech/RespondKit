import { describe, expect, it } from "vite-plus/test";

import { collectDiscordCommandTargets, topologyConfigurationSchema } from "./topology";

function topologyWithApplications(firstApplicationId: string, secondApplicationId: string) {
  return {
    workspaces: [
      {
        id: "workspace_test",
        slug: "test-workspace",
        name: "Test workspace",
        products: [
          {
            id: "product_test",
            slug: "test-product",
            name: "Test product",
            inboxes: [
              {
                id: "inbox_first",
                name: "First inbox",
                allowedOrigins: ["https://first.example.com"],
                discord: {
                  id: "discord_first",
                  applicationId: firstApplicationId,
                  guildId: "200000000000000001",
                  forumChannelId: "300000000000000001",
                  operators: {
                    userIds: ["400000000000000001"],
                    roleIds: [],
                  },
                },
              },
              {
                id: "inbox_second",
                name: "Second inbox",
                allowedOrigins: ["https://second.example.com"],
                discord: {
                  id: "discord_second",
                  applicationId: secondApplicationId,
                  guildId: "200000000000000002",
                  forumChannelId: "300000000000000002",
                  operators: {
                    userIds: [],
                    roleIds: ["400000000000000002"],
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("topologyConfigurationSchema", () => {
  it("supports several guilds owned by one deployed Discord application", () => {
    const configuration = topologyConfigurationSchema.parse(
      topologyWithApplications("100000000000000001", "100000000000000001"),
    );

    expect(collectDiscordCommandTargets(configuration)).toEqual([
      {
        applicationId: "100000000000000001",
        guildId: "200000000000000001",
      },
      {
        applicationId: "100000000000000001",
        guildId: "200000000000000002",
      },
    ]);
  });

  it("rejects Discord applications that cannot share the Worker public key", () => {
    const result = topologyConfigurationSchema.safeParse(
      topologyWithApplications("100000000000000001", "100000000000000002"),
    );

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        message: "All Discord integrations in one API deployment must use the same application ID",
        path: ["workspaces", 0, "products", 0, "inboxes", 1, "discord", "applicationId"],
      }),
    );
  });
});
