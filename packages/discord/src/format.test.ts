import { describe, expect, it } from "vite-plus/test";

import {
  formatCustomerProjectionContent,
  formatOperatorReplyAuditContent,
  languageDisplayName,
} from "./format";

describe("Discord transcript formatting", () => {
  it("renders stored locale tags as English language names", () => {
    expect(languageDisplayName("my-MM")).toBe("Burmese");
    expect(languageDisplayName("th-TH")).toBe("Thai");
    expect(languageDisplayName("en-US")).toBe("English");
    expect(languageDisplayName("not a locale")).toBe("not a locale");
  });

  it("makes the English customer translation primary and the original subtext", () => {
    expect(
      formatCustomerProjectionContent({
        originalText: "စာတမ်းကို export မလုပ်နိုင်ပါ။\nကူညီပေးပါ။",
        sourceLanguage: "my-MM",
        translatedText: "I cannot export my transcription. Please help.",
        needsReview: false,
      }),
    ).toBe(
      [
        "**Customer · Burmese → English**",
        "I cannot export my transcription. Please help.",
        "",
        "-# Original in Burmese",
        "-# စာတမ်းကို export မလုပ်နိုင်ပါ။",
        "-# ကူညီပေးပါ။",
      ].join("\n"),
    );
  });

  it("acknowledges the operator's English reply and de-emphasizes its translation", () => {
    expect(
      formatOperatorReplyAuditContent({
        originalText: "Please reopen the app.",
        targetLanguage: "my-MM",
        translatedText: "ကျေးဇူးပြု၍ အက်ပ်ကို ပြန်ဖွင့်ပါ။",
        needsReview: false,
      }),
    ).toBe(
      [
        "**Reply sent · English → Burmese**",
        "Please reopen the app.",
        "",
        "-# Customer received in Burmese",
        "-# ကျေးဇူးပြု၍ အက်ပ်ကို ပြန်ဖွင့်ပါ။",
      ].join("\n"),
    );
  });
});
