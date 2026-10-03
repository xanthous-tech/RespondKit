import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/store.ts"],
    dts: true,
    format: ["esm"],
    platform: "neutral",
    target: "es2022",
    clean: true,
    sourcemap: true,
    publint: { strict: true },
  },
  test: { environment: "node" },
});
