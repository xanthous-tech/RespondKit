import { createHttpApp } from "./http";

export { MessageWorkflow } from "./workflows/message";

const app = createHttpApp();

export default {
  fetch: app.fetch,
};
