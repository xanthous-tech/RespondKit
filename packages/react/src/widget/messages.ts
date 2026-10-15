// Generated from localization/messages by `pnpm localization:generate`. Edit the source catalogs.
const catalogs = {
  "en": {
    respondkit_another_message: () => "Send another message",
    respondkit_ask_anything: () => "Ask us anything",
    respondkit_attach_files: () => "Attach files",
    respondkit_attached_files: () => "Attached files",
    respondkit_cancel: () => "Cancel",
    respondkit_close: () => "Close",
    respondkit_close_chat: () => "Close support chat",
    respondkit_closed: () => "Closed",
    respondkit_closed_help: () => "This conversation is closed.",
    respondkit_confirming: () => "Confirming…",
    respondkit_connecting: () => "Support is still connecting.",
    respondkit_conversation: (inputs: { date: string }) => "Conversation " + String(inputs.date),
    respondkit_conversations: () => "Conversations",
    respondkit_conversations_unread: (inputs: { count: number }) => ({ one: "Conversations · " + String(inputs.count) + " unread", other: "Conversations · " + String(inputs.count) + " unread" })[new Intl.PluralRules("en").select(inputs.count) as "other"],
    respondkit_email_address: () => "Email address",
    respondkit_email_failed: () => "We couldn't save your email. Please check it and try again.",
    respondkit_email_prompt: () => "Where can we email you a reply?",
    respondkit_failed: () => "Failed",
    respondkit_file_open_failed: () => "Cannot open the selected file.",
    respondkit_files: () => "Files",
    respondkit_help: () => "How can we help?",
    respondkit_history_failed: () => "Conversation history could not be loaded. Try More again.",
    respondkit_identity_changed: () => "Support identity changed in another tab. Reconnect to reload your account.",
    respondkit_intro: () => "Send a message and keep this page open for a quick reply.",
    respondkit_intro_short: () => "Send a message to start a conversation.",
    respondkit_latest: () => "Latest messages",
    respondkit_loading: () => "Loading…",
    respondkit_loading_messages: () => "Loading messages",
    respondkit_message: () => "Message",
    respondkit_messages_failed: () => "New messages could not be loaded.",
    respondkit_more: () => "More",
    respondkit_new_conversation: () => "New conversation",
    respondkit_new_count: (inputs: { count: number }) => ({ one: String(inputs.count) + " new", other: String(inputs.count) + " new" })[new Intl.PluralRules("en").select(inputs.count) as "other"],
    respondkit_open: () => "Open",
    respondkit_open_chat: () => "Open support chat",
    respondkit_photo_library: () => "Photo library",
    respondkit_picker_failed: () => "Cannot open file picker",
    respondkit_ready: () => "Ready",
    respondkit_reconnect: () => "Reconnect",
    respondkit_reconnect_upload: () => "Reconnect before uploading.",
    respondkit_remove: () => "Remove",
    respondkit_remove_file: (inputs: { name: string }) => "Remove " + String(inputs.name),
    respondkit_request_failed: () => "Support request failed.",
    respondkit_retry: () => "Retry",
    respondkit_retry_message: () => "Retry message",
    respondkit_return: () => "Your replies will appear here when you return to the app.",
    respondkit_save_email: () => "Save email",
    respondkit_saving: () => "Saving…",
    respondkit_selected_file: () => "Selected file",
    respondkit_send: () => "Send",
    respondkit_send_message: () => "Send message",
    respondkit_sending: () => "Sending…",
    respondkit_sent: () => "Sent",
    respondkit_session_expired: () => "Your support session expired. Reconnect to continue.",
    respondkit_show_new: (inputs: { count: number }) => ({ one: "Show " + String(inputs.count) + " new message", other: "Show " + String(inputs.count) + " new messages" })[new Intl.PluralRules("en").select(inputs.count) as "other"],
    respondkit_sign_in_again: () => "Sign in again to restore your support history.",
    respondkit_start_failed: () => "Support chat could not be started.",
    respondkit_support: () => "Support",
    respondkit_support_messages: () => "Support messages",
    respondkit_try_again: () => "Try again",
    respondkit_unknown: () => "Not confirmed — retry safely",
    respondkit_unread: () => "Unread support reply",
    respondkit_upload_failed: () => "Upload failed",
    respondkit_write_message: () => "Write a message…",
  },
};
export type Messages = (typeof catalogs)["en"];
function canonical(locale: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}
/** The closest shipped catalog for a BCP 47 tag, else the base locale. */
export function messages(locale?: string): Messages {
  let tag = locale ? canonical(locale) : undefined;
  while (tag) {
    if (tag in catalogs) return catalogs[tag as keyof typeof catalogs];
    tag = tag.includes("-") ? tag.slice(0, tag.lastIndexOf("-")) : undefined;
  }
  return catalogs["en"];
}
