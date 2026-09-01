import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    tsconfigPaths: true,
  },
  optimizeDeps: {
    include: ["fumadocs-mdx/macro", "fumadocs-mdx/runtime/macro"],
  },
  environments: {
    ssr: {
      optimizeDeps: {
        include: ["fumadocs-mdx/macro", "fumadocs-mdx/runtime/macro"],
      },
    },
  },
  server: { port: 3000 },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  test: {
    passWithNoTests: true,
  },
});
