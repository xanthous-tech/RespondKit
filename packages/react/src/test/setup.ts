import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

class ResizeObserverMock implements ResizeObserver {
  disconnect() {}

  observe() {}

  unobserve() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

if (Element.prototype.getAnimations === undefined) {
  Element.prototype.getAnimations = () => [];
}

afterEach(cleanup);
