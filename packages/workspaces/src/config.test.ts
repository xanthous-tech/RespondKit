import { describe, expect, it } from "vite-plus/test";

import {
  allowedOriginConfigSchema,
  normalizeAllowedOrigin,
  normalizeOrigin,
  originAllowlistCandidates,
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

  it("allows any port only for loopback development hosts", () => {
    expect(normalizeAllowedOrigin("HTTP://LOCALHOST:*/")).toBe("http://localhost:*");
    expect(normalizeAllowedOrigin("https://[::1]:*")).toBe("https://[::1]:*");
    expect(originAllowlistCandidates("http://localhost:5174")).toEqual([
      "http://localhost:5174",
      "http://localhost:*",
    ]);
    expect(originAllowlistCandidates("https://product.example.com")).toEqual([
      "https://product.example.com",
    ]);
  });

  it.each(["*", "https://*", "https://*.example.com", "http://192.168.1.20:*"])(
    "rejects a non-loopback wildcard: %s",
    (value) => {
      expect(allowedOriginConfigSchema.safeParse(value).success).toBe(false);
    },
  );

  it("validates a minimal workspace topology", () => {
    const result = workspaceConfigurationSchema.parse({
      id: "workspace_one",
      slug: "example-product",
      name: "Example Product",
      products: [
        {
          id: "product_example",
          slug: "example-product",
          name: "Example Product",
          inboxes: [
            {
              id: "inbox_example",
              name: "Customer support",
              allowedOrigins: ["https://product.example.com"],
            },
          ],
        },
      ],
    });

    expect(result.products[0]?.inboxes[0]?.allowedOrigins).toEqual(["https://product.example.com"]);
  });

  it("rejects an invalid default language tag before it reaches translation", () => {
    const result = workspaceConfigurationSchema.safeParse({
      id: "workspace_one",
      slug: "example-product",
      name: "Example Product",
      products: [
        {
          id: "product_example",
          slug: "example-product",
          name: "Example Product",
          inboxes: [
            {
              id: "inbox_example",
              name: "Customer support",
              defaultLocale: "not_a_language",
              allowedOrigins: ["https://product.example.com"],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
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
