import { describe, expect, it } from "vite-plus/test";

import {
  allowedOriginConfigSchema,
  normalizeOrigin,
  visitorContextSchema,
  workspaceConfigurationSchema,
} from "./config";

describe("normalizeOrigin", () => {
  it("returns a canonical HTTP origin", () => {
    expect(normalizeOrigin("HTTPS://Example.COM:443/")).toBe("https://example.com");
    expect(normalizeOrigin("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it.each([
    "ftp://example.com",
    "https://user@example.com",
    "https://example.com/support",
    "https://example.com?workspace=one",
    "https://example.com/#support",
  ])("rejects a value that is not an origin: %s", (value) => {
    expect(() => normalizeOrigin(value)).toThrow(TypeError);
  });
});

describe("workspace configuration", () => {
  it("normalizes configured origins", () => {
    expect(allowedOriginConfigSchema.parse("https://EXAMPLE.com/")).toBe("https://example.com");
  });

  it("validates a minimal workspace topology", () => {
    const result = workspaceConfigurationSchema.parse({
      id: "workspace_one",
      slug: "canto-transcriber",
      name: "Canto Transcriber",
      products: [
        {
          id: "product_canto",
          slug: "canto-transcriber",
          name: "Canto Transcriber",
          inboxes: [
            {
              id: "inbox_canto",
              name: "Customer support",
              allowedOrigins: ["https://canto.example.com"],
            },
          ],
        },
      ],
    });

    expect(result.products[0]?.inboxes[0]?.allowedOrigins).toEqual(["https://canto.example.com"]);
  });
});

describe("visitor context", () => {
  it("rejects unbounded metadata", () => {
    const result = visitorContextSchema.safeParse({
      id: "visitor_one",
      installationId: "install_profile_one",
      metadata: { payload: "x".repeat(16_400) },
    });

    expect(result.success).toBe(false);
  });
});
