export const DiscordApplicationCommandType = {
  ChatInput: 1,
} as const;

export const DiscordApplicationCommandOptionType = {
  String: 3,
} as const;

export interface DiscordStringCommandOptionDefinition {
  readonly type: typeof DiscordApplicationCommandOptionType.String;
  readonly name: string;
  readonly description: string;
  readonly required: true;
  readonly min_length: number;
  readonly max_length: number;
}

export interface DiscordChatInputCommandDefinition {
  readonly type: typeof DiscordApplicationCommandType.ChatInput;
  readonly name: DiscordCommandName;
  readonly description: string;
  readonly default_member_permissions: "0";
  readonly options: readonly DiscordStringCommandOptionDefinition[];
}

export type DiscordCommandName = "reply" | "retry" | "status";

export const DISCORD_REPLY_COMMAND = {
  type: DiscordApplicationCommandType.ChatInput,
  name: "reply",
  description: "Reply to the customer in this support thread",
  default_member_permissions: "0",
  options: [
    {
      type: DiscordApplicationCommandOptionType.String,
      name: "message",
      description: "English reply to send to the customer",
      required: true,
      min_length: 1,
      max_length: 6_000,
    },
  ],
} as const satisfies DiscordChatInputCommandDefinition;

export const DISCORD_STATUS_COMMAND = {
  type: DiscordApplicationCommandType.ChatInput,
  name: "status",
  description: "Check a pending support reply by interaction reference",
  default_member_permissions: "0",
  options: [
    {
      type: DiscordApplicationCommandOptionType.String,
      name: "reference",
      description: "Original Discord interaction ID",
      required: true,
      min_length: 1,
      max_length: 32,
    },
  ],
} as const satisfies DiscordChatInputCommandDefinition;

export const DISCORD_RETRY_COMMAND = {
  type: DiscordApplicationCommandType.ChatInput,
  name: "retry",
  description: "Retry a support reply using its original interaction ID",
  default_member_permissions: "0",
  options: [
    {
      type: DiscordApplicationCommandOptionType.String,
      name: "reference",
      description: "Original Discord interaction ID",
      required: true,
      min_length: 1,
      max_length: 32,
    },
    {
      type: DiscordApplicationCommandOptionType.String,
      name: "message",
      description: "The exact original English reply",
      required: true,
      min_length: 1,
      max_length: 6_000,
    },
  ],
} as const satisfies DiscordChatInputCommandDefinition;

export const DISCORD_GUILD_COMMANDS = [
  DISCORD_REPLY_COMMAND,
  DISCORD_STATUS_COMMAND,
  DISCORD_RETRY_COMMAND,
] as const satisfies readonly DiscordChatInputCommandDefinition[];
