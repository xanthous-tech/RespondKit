import { z } from "zod";

const discordSnowflakeSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^\d+$/, "Discord IDs must contain only digits");

const discordPrincipalIdsSchema = z
  .array(discordSnowflakeSchema)
  .max(100)
  .transform((ids) => [...new Set(ids)].sort());

export const discordIntegrationConfigurationSchema = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9_-]+$/),
    applicationId: discordSnowflakeSchema,
    guildId: discordSnowflakeSchema,
    forumChannelId: discordSnowflakeSchema,
    operators: z.strictObject({
      userIds: discordPrincipalIdsSchema,
      roleIds: discordPrincipalIdsSchema,
    }),
  })
  .refine(
    (configuration) =>
      configuration.operators.userIds.length > 0 || configuration.operators.roleIds.length > 0,
    {
      message: "A Discord integration requires at least one allowed operator user or role",
      path: ["operators"],
    },
  );

export type DiscordIntegrationConfiguration = z.infer<typeof discordIntegrationConfigurationSchema>;
