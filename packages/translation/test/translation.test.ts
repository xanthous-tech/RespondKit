import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  DEFAULT_GEMINI_MODEL_ID,
  PlaceholderIntegrityError,
  TranslationError,
  classifyTranslationError,
  createGeminiTranslationModel,
  createTranslator,
  maskProtectedText,
  restoreProtectedText,
} from "../src";

const usage = {
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: 10,
    total: 10,
  },
  outputTokens: {
    reasoning: undefined,
    text: 20,
    total: 20,
  },
};

function modelWithOutput(
  output:
    | {
        ambiguityNotes: string[];
        mixedLanguage: boolean;
        needsReview: boolean;
        sourceLanguage: string;
        targetLanguage: string;
        translatedText: string;
      }
    | (() => never),
): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      if (typeof output === "function") {
        return output();
      }

      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        finishReason: { raw: undefined, unified: "stop" },
        usage,
        warnings: [],
      };
    },
  });
}

describe("protected text", () => {
  it("restores URLs, email, code, routes, identifiers, and coupons byte-for-byte", () => {
    const source = [
      "Email me at dev@example.com and open https://canto.example/settings?q=1.",
      "Use `accountId`, /settings/billing, usr_abcd1234, and SAVE-20.",
      "```ts\nconst appRoute = '/support/new'\n```",
    ].join("\n");

    const masked = maskProtectedText(source);

    expect(masked.text).not.toContain("dev@example.com");
    expect(masked.text).not.toContain("https://canto.example/settings?q=1");
    expect(masked.text).not.toContain("/settings/billing");
    expect(masked.text).not.toContain("SAVE-20");
    expect(restoreProtectedText(masked.text, masked.fragments)).toBe(source);
  });

  it("rejects missing, duplicate, and invented placeholders", () => {
    const masked = maskProtectedText("Open /settings and use SAVE-20");
    const [first, second] = masked.fragments;

    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const invalid = `${first?.placeholder} ${first?.placeholder} [[[AC_TOKEN_9999]]]`;

    expect(() => restoreProtectedText(invalid, masked.fragments)).toThrowError(
      PlaceholderIntegrityError,
    );

    try {
      restoreProtectedText(invalid, masked.fragments);
    } catch (error) {
      expect(error).toMatchObject({
        duplicate: [first?.placeholder],
        missing: [second?.placeholder],
        retryable: true,
        unknown: ["[[[AC_TOKEN_9999]]]"],
      });
    }
  });

  it("preserves explicit glossary terms", () => {
    const masked = maskProtectedText("Use Canto Transcriber today", {
      preserve: ["Canto Transcriber"],
    });

    expect(masked.fragments).toEqual([
      expect.objectContaining({
        kind: "glossary",
        value: "Canto Transcriber",
      }),
    ]);
    expect(restoreProtectedText(masked.text, masked.fragments)).toBe("Use Canto Transcriber today");
  });
});

describe("translator", () => {
  it("translates a Burmese fixture to English and restores protected values", async () => {
    const source = "ငွေပေးချေမှု မအောင်မြင်ပါ။ /settings/billing မှာ usr_abcd1234 ကို စစ်ပေးပါ။";
    const masked = maskProtectedText(source);
    const placeholders = masked.fragments.map((fragment) => fragment.placeholder);
    const model = modelWithOutput({
      ambiguityNotes: [],
      mixedLanguage: false,
      needsReview: false,
      sourceLanguage: "my",
      targetLanguage: "en",
      translatedText: `The payment failed. Please check ${placeholders.join(" in ")}.`,
    });

    const result = await createTranslator({ model }).translate({
      targetLanguage: "en",
      text: source,
    });

    expect(result).toMatchObject({
      passThrough: false,
      sourceLanguage: "my",
      targetLanguage: "en",
      translatedText: "The payment failed. Please check /settings/billing in usr_abcd1234.",
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "narrow customer-support translator",
    );
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).not.toContain("/settings/billing");
    expect(model.doGenerateCalls[0]?.providerOptions).toMatchObject({
      google: { thinkingConfig: { thinkingLevel: "minimal" } },
    });
  });

  it("translates a Thai fixture with context and a preserved product name", async () => {
    const source = "Canto Transcriber เปิดไฟล์ไม่ได้ ติดต่อ help@example.com";
    const masked = maskProtectedText(source, {
      preserve: ["Canto Transcriber"],
    });
    const placeholders = masked.fragments.map((fragment) => fragment.placeholder);
    const model = modelWithOutput({
      ambiguityNotes: [],
      mixedLanguage: true,
      needsReview: false,
      sourceLanguage: "th",
      targetLanguage: "en",
      translatedText: `${placeholders[0]} cannot open the file. Contact ${placeholders[1]}.`,
    });

    const result = await createTranslator({ model }).translate({
      context: [
        { role: "customer", text: "ฉันอัปโหลดเสียงแล้ว" },
        { role: "operator", text: "Which file format did you upload?" },
      ],
      glossary: [{ preserve: true, source: "Canto Transcriber" }],
      targetLanguage: "en",
      text: source,
    });

    expect(result.translatedText).toBe(
      "Canto Transcriber cannot open the file. Contact help@example.com.",
    );
    expect(result.mixedLanguage).toBe(true);
  });

  it("passes explicit English input through without calling a model", async () => {
    const doGenerate = vi.fn(() => {
      throw new Error("must not be called");
    });
    const model = modelWithOutput(doGenerate);

    const result = await createTranslator({ model }).translate({
      sourceLanguage: "en-US",
      targetLanguage: "en",
      text: "Please help with /settings/billing",
    });

    expect(result).toMatchObject({
      passThrough: true,
      sourceLanguage: "en-US",
      targetLanguage: "en",
      translatedText: "Please help with /settings/billing",
    });
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it("classifies placeholder corruption as retryable invalid output", async () => {
    const model = modelWithOutput({
      ambiguityNotes: [],
      mixedLanguage: false,
      needsReview: false,
      sourceLanguage: "th",
      targetLanguage: "en",
      translatedText: "The model dropped the route",
    });

    await expect(
      createTranslator({ model }).translate({
        targetLanguage: "en",
        text: "เปิด /settings/billing ไม่ได้",
      }),
    ).rejects.toMatchObject({
      code: "invalid_output",
      retryable: true,
    });
  });

  it("disables SDK retries so Workflows owns retry policy", async () => {
    let calls = 0;
    const apiError = new APICallError({
      message: "busy",
      requestBodyValues: {},
      statusCode: 429,
      url: "https://example.invalid",
    });
    const model = modelWithOutput(() => {
      calls += 1;
      throw apiError;
    });

    await expect(
      createTranslator({ model }).translate({
        targetLanguage: "en",
        text: "မင်္ဂလာပါ",
      }),
    ).rejects.toMatchObject({
      code: "provider_retryable",
      retryable: true,
      statusCode: 429,
    });
    expect(calls).toBe(1);
  });

  it("rejects a mismatched target language as retryable invalid output", async () => {
    const model = modelWithOutput({
      ambiguityNotes: [],
      mixedLanguage: false,
      needsReview: false,
      sourceLanguage: "th",
      targetLanguage: "zh",
      translatedText: "Hello",
    });

    await expect(
      createTranslator({ model }).translate({
        targetLanguage: "en",
        text: "สวัสดี",
      }),
    ).rejects.toMatchObject({
      code: "invalid_output",
      retryable: true,
    });
  });

  it.each(["   ", "x".repeat(24_001)])(
    "rejects an invalid translated text length as retryable output",
    async (translatedText) => {
      const model = modelWithOutput({
        ambiguityNotes: [],
        mixedLanguage: false,
        needsReview: false,
        sourceLanguage: "th",
        targetLanguage: "en",
        translatedText,
      });

      await expect(
        createTranslator({ model }).translate({
          targetLanguage: "en",
          text: "สวัสดี",
        }),
      ).rejects.toMatchObject({
        code: "invalid_output",
        retryable: true,
      });
    },
  );
});

describe("failure classification", () => {
  it.each([
    { expected: true, statusCode: 408 },
    { expected: true, statusCode: 429 },
    { expected: true, statusCode: 500 },
    { expected: false, statusCode: 400 },
    { expected: false, statusCode: 401 },
  ])("classifies HTTP $statusCode", ({ expected, statusCode }) => {
    const error = new APICallError({
      message: "provider error",
      requestBodyValues: {},
      statusCode,
      url: "https://example.invalid",
    });

    expect(classifyTranslationError(error)).toMatchObject({
      retryable: expected,
      statusCode,
    });
  });

  it("treats invalid input and configuration as permanent", async () => {
    const model = modelWithOutput(() => {
      throw new Error("must not be called");
    });

    await expect(
      createTranslator({ model }).translate({
        targetLanguage: "en",
        text: "   ",
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      retryable: false,
    });

    expect(() => createGeminiTranslationModel({ apiKey: "" })).toThrowError(TranslationError);
    try {
      createGeminiTranslationModel({ apiKey: "" });
    } catch (error) {
      expect(error).toMatchObject({
        code: "configuration",
        retryable: false,
      });
    }
  });

  it("creates the default Gemini model without making a request", () => {
    const model = createGeminiTranslationModel({ apiKey: "test-key-not-real" });

    expect(typeof model).not.toBe("string");
    if (typeof model !== "string") {
      expect(model.modelId).toBe(DEFAULT_GEMINI_MODEL_ID);
    }
  });
});
