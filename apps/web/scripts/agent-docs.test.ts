import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { buildAgentDocs } from "./agent-docs";

describe("agent documentation", () => {
  it("exports every navigable guide with valid internal Markdown links and intact code", async () => {
    const outputs = await buildAgentDocs(
      fileURLToPath(new URL("../content/docs", import.meta.url)),
    );
    const index = outputs.get("llms.txt")!;
    for (const [, destination] of index.matchAll(/\]\((\/docs-markdown\/[^)]+)\)/g)) {
      expect(outputs.has(destination!.slice(1))).toBe(true);
    }
    for (const text of outputs.values()) {
      for (const [, destination] of text.matchAll(/\]\((\/docs-markdown\/[^)#]+)(?:#[^)]*)?\)/g)) {
        expect(outputs.has(destination!.slice(1))).toBe(true);
      }
    }
    const nativeGuide = outputs.get("docs-markdown/react-native.md")!;
    expect(nativeGuide).toContain("```tsx\n");
    expect(nativeGuide).toContain("<RespondKitLifecycle store={store} />");
    expect(outputs.get("llms-full.txt")).toContain(nativeGuide);
    expect(outputs.get("docs-markdown/agent-api.md")).toContain("no shipped product-scoped");
  });
});
