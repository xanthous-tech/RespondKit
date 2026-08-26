# React widget v1

Status: implemented and key-free tested on desktop and mobile

## Direction

The widget borrows the useful product ideas from [chatcn](https://github.com/leonickson1/chatcn)—copy-owned shadcn components, a small provider-free widget surface, rounded message groups, explicit delivery state, responsive widget/full-screen layouts, and theme tokens—without adopting its much broader messenger feature set.

For the Canto MVP, the deliberately narrow surface is:

- one launcher and one support dialog;
- a persistent customer thread with cursor polling;
- customer/operator bubbles, local time, date separators, and delivery state;
- optimistic send, acceptance-unknown handling, retry, reconnect notice, and unseen-message affordance;
- Enter to send, Shift+Enter for a newline, IME-safe composition, Escape to close, and focus restoration;
- a compact floating card on desktop and a full-height panel on mobile.

Reactions, rich text, replies, presence, typing indicators, search, voice, and media are intentionally deferred. Photo/video upload is the first likely follow-on after the text/translation/Discord loop survives real use.

## Host-app isolation

The implementation uses Tailwind CSS v4 and local shadcn primitives built on Base UI. All generated utilities carry the `ac:` Tailwind prefix, all product tokens use `--agent-chat-*`, and the package omits Tailwind preflight. Portaled tooltip content reapplies the widget token root and sits above the widget's embed layer. This prevents common utilities and shadcn variables from overriding—or being overridden by—the host application's Tailwind theme.

The visual baseline uses white and cool neutral surfaces with a configurable action color. Customer messages use a soft accent fill; support replies use a neutral fill. Translation stays in the support workflow rather than adding a persistent notice to the customer-facing widget.

## Accent colors

`AgentChatWidget` accepts an optional `accentColor` prop. It defaults to `"indigo"` and supports the standard Tailwind palette families: `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`, `slate`, `gray`, `zinc`, `neutral`, and `stone`.

The package exports both the `AgentChatAccentColor` type and `agentChatAccentPalette` map. The selected family sets the widget-scoped `--agent-chat-primary` and `--agent-chat-ring` tokens, so it does not depend on or mutate the host application's Tailwind theme.

## Visual references

- [Generated concept](widget-concept-v1.png)
- Browser regression screenshots are produced by `pnpm --dir apps/widget test:e2e` for 1280×800 desktop and 390×844 mobile viewports.

The browser test opens the launcher, restores a transcript, sends Thai text, waits for canonical acceptance, verifies the mobile full-screen state, closes the dialog, and checks focus restoration.
