import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    attw: {
      level: "error",
      profile: "esm-only",
    },
    clean: true,
    dts: true,
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "neutral",
    publint: {
      strict: true,
    },
    sourcemap: true,
    target: "es2022",
  },
});
