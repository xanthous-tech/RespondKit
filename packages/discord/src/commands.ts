export const DiscordApplicationCommandType = {
  ChatInput: 1,
  Message: 3,
} as const;

export const DiscordApplicationCommandOptionType = {
  String: 3,
  Integer: 4,
} as const;

export interface DiscordStringCommandOptionDefinition {
  readonly type: typeof DiscordApplicationCommandOptionType.String;
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly min_length: number;
  readonly max_length: number;
  readonly choices?: readonly { readonly name: string; readonly value: string }[];
}

export interface DiscordIntegerCommandOptionDefinition {
  readonly type: 4;
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly min_value: number;
  readonly max_value: number;
}

export interface DiscordChatInputCommandDefinition {
  readonly type: typeof DiscordApplicationCommandType.ChatInput;
  readonly name: DiscordCommandName;
  readonly description: string;
  readonly default_member_permissions: "0";
  readonly options: readonly (
    | DiscordStringCommandOptionDefinition
    | DiscordIntegerCommandOptionDefinition
  )[];
}

export type DiscordCommandName = "reply" | "retry" | "status" | "translate" | "activity";

export const DISCORD_REPLY_COMMAND = {
  type: DiscordApplicationCommandType.ChatInput,
  name: "reply",
  description: "Reply to the customer in this support thread",
  default_member_permissions: "0",
  options: [
    {
      type: DiscordApplicationCommandOptionType.String,
      name: "message",
      description: "Reply to send as written unless translate is specified",
      required: true,
      min_length: 1,
      max_length: 6_000,
    },
    {
      type: 3,
      name: "translate",
      description: "off (default), customer, or a target language code such as hi",
      required: false,
      min_length: 2,
      max_length: 35,
    },
  ],
} as const satisfies DiscordChatInputCommandDefinition;

export const DISCORD_TRANSLATE_COMMAND = {
  type: DiscordApplicationCommandType.ChatInput,
  name: "translate",
  description: "Translate a customer message (defaults to the latest message, into English)",
  default_member_permissions: "0",
  options: [
    {
      type: 3,
      name: "message",
      description: "Discord message link in this support thread",
      required: false,
      min_length: 1,
      max_length: 200,
    },
    {
      type: 3,
      name: "to",
      description: "Target language code, for example en, hi, or my (default en)",
      required: false,
      min_length: 2,
      max_length: 35,
    },
  ],
} as const satisfies DiscordChatInputCommandDefinition;

export const DISCORD_TRANSLATE_MESSAGE_COMMAND = {
  type: DiscordApplicationCommandType.Message,
  name: "Translate to English",
  default_member_permissions: "0",
} as const;

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

export const DISCORD_ACTIVITY_COMMAND = {
  type: 1,
  name: "activity",
  description: "Show this customer's PostHog pageviews and events in the support thread",
  default_member_permissions: "0",
  options: [
    {
      type: 4,
      name: "count",
      description: "Latest events to show (1–100; default 20, or 100 with minutes)",
      required: false,
      min_value: 1,
      max_value: 100,
    },
    {
      type: 4,
      name: "minutes",
      description: "Look back this many minutes (1–10080; default seven days)",
      required: false,
      min_value: 1,
      max_value: 10080,
    },
    {
      type: 3,
      name: "kind",
      description: "Activity to include (default all)",
      required: false,
      min_length: 3,
      max_length: 9,
      choices: [
        { name: "Pageviews and product activity", value: "all" },
        { name: "Pageviews only", value: "pageviews" },
        { name: "Product events only", value: "events" },
      ],
    },
    {
      type: 3,
      name: "until",
      description: "End the window now or at the latest customer message (default now)",
      required: false,
      min_length: 3,
      max_length: 12,
      choices: [
        { name: "Now", value: "now" },
        { name: "Last customer message", value: "last_message" },
      ],
    },
  ],
} as const satisfies DiscordChatInputCommandDefinition;

export const DISCORD_GUILD_COMMANDS = [
  DISCORD_REPLY_COMMAND,
  DISCORD_STATUS_COMMAND,
  DISCORD_RETRY_COMMAND,
  DISCORD_TRANSLATE_COMMAND,
  DISCORD_TRANSLATE_MESSAGE_COMMAND,
  DISCORD_ACTIVITY_COMMAND,
] as const;
