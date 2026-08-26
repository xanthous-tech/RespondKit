import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    passWithNoTests: true,
  },
});
