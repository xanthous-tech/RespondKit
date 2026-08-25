import "@agent-chat/react/styles.css";

import { AgentChatWidget } from "@agent-chat/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { demoApiFetch } from "./demo-api";
import "./playground.css";

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Widget playground root was not found");
}

createRoot(root).render(
  <StrictMode>
    <main className="playground-shell">
      <section className="playground-copy">
        <h1>Transcribe Cantonese with confidence.</h1>
        <p>
          A neutral host page for exercising the real support widget at desktop and mobile widths.
        </p>
      </section>
      <AgentChatWidget
        apiBaseUrl={import.meta.env.VITE_AGENT_CHAT_API_URL ?? "https://demo.agent-chat.local"}
        context={{
          inboxId: import.meta.env.VITE_AGENT_CHAT_INBOX_ID ?? "inbox_demo",
          locale: navigator.language,
          path: window.location.pathname,
        }}
        fetch={import.meta.env.VITE_AGENT_CHAT_API_URL === undefined ? demoApiFetch : undefined}
        title="Canto Support"
      />
    </main>
  </StrictMode>,
);
