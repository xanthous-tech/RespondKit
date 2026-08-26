import {
  AgentChatWidget,
  agentChatAccentPalette,
  type AgentChatAccentColor,
} from "@agent-chat/react";
import { useState } from "react";

import { demoApiFetch } from "./demo-api";

const accentColors = Object.keys(agentChatAccentPalette) as AgentChatAccentColor[];

export function Playground() {
  const [title, setTitle] = useState("Canto Support");
  const [accentColor, setAccentColor] = useState<AgentChatAccentColor>("indigo");
  const [initiallyOpen, setInitiallyOpen] = useState(false);

  return (
    <main className="playground-shell">
      <section className="configuration-panel" aria-labelledby="configuration-heading">
        <div className="configuration-heading">
          <h1 id="configuration-heading">Widget configuration</h1>
          <p>Adjust the support experience without rebuilding the host page.</p>
        </div>

        <div className="configuration-fields">
          <label className="configuration-field">
            <span>Widget title</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              maxLength={80}
            />
          </label>

          <label className="configuration-field">
            <span>Accent color</span>
            <span className="color-select-shell">
              <span
                className="color-swatch"
                style={{ backgroundColor: agentChatAccentPalette[accentColor] }}
                aria-hidden="true"
              />
              <select
                value={accentColor}
                onChange={(event) =>
                  setAccentColor(event.currentTarget.value as AgentChatAccentColor)
                }
              >
                {accentColors.map((color) => (
                  <option key={color} value={color}>
                    {color.charAt(0).toUpperCase() + color.slice(1)}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <label className="configuration-toggle">
            <input
              type="checkbox"
              checked={initiallyOpen}
              onChange={(event) => setInitiallyOpen(event.currentTarget.checked)}
            />
            <span>
              <strong>Open on load</strong>
              <small>Reset the preview into its open state.</small>
            </span>
          </label>
        </div>
      </section>

      <AgentChatWidget
        key={`initially-open-${initiallyOpen}`}
        accentColor={accentColor}
        apiBaseUrl={import.meta.env.VITE_AGENT_CHAT_API_URL ?? "https://demo.agent-chat.local"}
        context={{
          inboxId: import.meta.env.VITE_AGENT_CHAT_INBOX_ID ?? "inbox_demo",
          locale: navigator.language,
          path: window.location.pathname,
        }}
        fetch={import.meta.env.VITE_AGENT_CHAT_API_URL === undefined ? demoApiFetch : undefined}
        initiallyOpen={initiallyOpen}
        title={title || "Support"}
      />
    </main>
  );
}
