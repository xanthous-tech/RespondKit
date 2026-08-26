import "@respondkit/react/styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Playground } from "./playground";
import "./playground.css";

if (import.meta.env.DEV) {
  void import("react-grab").then(({ getGlobalApi, init, setGlobalApi }) => {
    let api = getGlobalApi();
    if (api === null) {
      api = init();
      setGlobalApi(api);
    }

    api.setToolbarState({
      defaultAction: "comment",
      collapsed: false,
      enabled: true,
    });
  });
}

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Widget playground root was not found");
}

createRoot(root).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
