import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { MessageText } from "./message-text";
import cases from "../../../../native/fixtures/message-links.json";

describe("message URL links", () => {
  it.each(cases)("preserves text and detects links in $text", ({ text, links }) => {
    const { container } = render(<MessageText text={text} />);
    expect(container.textContent).toBe(text);
    const anchors = screen.queryAllByRole("link");
    expect(anchors).toHaveLength(links.length);
    anchors.forEach((anchor, index) => {
      expect(anchor.textContent).toBe(links[index]!.text);
      expect(anchor).toHaveAttribute("href", links[index]!.url);
      expect(anchor).toHaveAttribute("target", "_blank");
      expect(anchor).toHaveAttribute("rel", "noopener noreferrer");
    });
    expect(container.querySelector("script")).toBeNull();
  });
});
