import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const packages = [
  { directory: "packages/protocol", name: "@respondkit/protocol" },
  { directory: "packages/api-client", name: "@respondkit/api-client" },
  { directory: "packages/react", name: "@respondkit/react" },
] as const;

function run(command: string, args: readonly string[], cwd: string) {
  const env = { ...process.env };
  if (command === "npm") {
    for (const key of Object.keys(env)) {
      if (key.toLowerCase().startsWith("npm_config_")) delete env[key];
    }
  }
  execFileSync(command, [...args], { cwd, env, stdio: "inherit" });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "respondkit-npm-check-"));
const tarballDirectory = join(temporaryRoot, "tarballs");
const consumerDirectory = join(temporaryRoot, "consumer");

try {
  await Promise.all([
    mkdir(tarballDirectory, { recursive: true }),
    mkdir(consumerDirectory, { recursive: true }),
  ]);

  const packageTarballs = new Map<string, string>();
  for (const packageDefinition of packages) {
    const manifest = JSON.parse(
      await readFile(join(workspaceRoot, packageDefinition.directory, "package.json"), "utf8"),
    ) as { version: string };
    const tarball = `${packageDefinition.name.slice(1).replace("/", "-")}-${manifest.version}.tgz`;
    run(
      "pnpm",
      ["-C", packageDefinition.directory, "pack", "--pack-destination", tarballDirectory],
      workspaceRoot,
    );
    packageTarballs.set(packageDefinition.name, join(tarballDirectory, tarball));
  }

  await writeFile(
    join(consumerDirectory, "package.json"),
    JSON.stringify(
      { name: "respondkit-package-smoke-test", private: true, type: "module" },
      null,
      2,
    ),
    { flag: "wx" },
  );

  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      ...packages.map(({ name }) => packageTarballs.get(name)!),
      "react@19.2.8",
      "react-dom@19.2.8",
      "@types/react@19.2.18",
      "@types/react-dom@19.2.5",
      "@tailwindcss/vite@4.3.3",
      "@vitejs/plugin-react@6.1.0",
      "typescript@7.0.2",
      "vite@8.2.2",
    ],
    consumerDirectory,
  );

  await writeFile(
    join(consumerDirectory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          jsx: "react-jsx",
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        include: ["consumer.tsx"],
      },
      null,
      2,
    ),
    { flag: "wx" },
  );

  await writeFile(
    join(consumerDirectory, "consumer.tsx"),
    `import { createRespondKitClient } from "@respondkit/api-client";
import { API_VERSION } from "@respondkit/protocol";
import { RespondKitWidget, respondKitAccentPalette } from "@respondkit/react";
import "@respondkit/react/styles.css";
import { createRoot } from "react-dom/client";

const client = createRespondKitClient({ baseUrl: "https://api.respondkit.dev" });
const widget = (
  <RespondKitWidget
    apiBaseUrl="https://api.respondkit.dev"
    accentColor="lime"
    context={{ inboxId: "inbox_example" }}
  />
);

void client;
void widget;
void API_VERSION;
void respondKitAccentPalette;

createRoot(document.querySelector("#root")!).render(widget);
`,
    { flag: "wx" },
  );

  await writeFile(
    join(consumerDirectory, "index.html"),
    '<div id="root"></div><script type="module" src="/consumer.tsx"></script>',
    { flag: "wx" },
  );

  await writeFile(
    join(consumerDirectory, "vite.config.ts"),
    `import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [react(), tailwindcss()] });
`,
    { flag: "wx" },
  );

  await writeFile(
    join(consumerDirectory, "runtime.mjs"),
    `import { createRespondKitClient } from "@respondkit/api-client";
import { API_VERSION } from "@respondkit/protocol";
import { RespondKitWidget } from "@respondkit/react";

if (typeof createRespondKitClient !== "function") throw new Error("API client export missing");
if (API_VERSION !== "v1") throw new Error("Protocol export missing");
if (typeof RespondKitWidget !== "function") throw new Error("React export missing");

const styleUrl = import.meta.resolve("@respondkit/react/styles.css");
if (!styleUrl.endsWith("/src/styles.css")) throw new Error("Stylesheet export missing");
`,
    { flag: "wx" },
  );

  run("npm", ["exec", "--", "tsc", "--noEmit"], consumerDirectory);
  run("node", ["runtime.mjs"], consumerDirectory);
  run("npm", ["exec", "--", "vite", "build"], consumerDirectory);

  const builtCssFile = (await readdir(join(consumerDirectory, "dist/assets"))).find((file) =>
    file.endsWith(".css"),
  );
  if (builtCssFile === undefined) throw new Error("Vite consumer did not emit widget CSS");
  const builtCss = await readFile(join(consumerDirectory, "dist/assets", builtCssFile), "utf8");
  if (!builtCss.includes(".respondkit-root") || !builtCss.includes(".ac\\:fixed")) {
    throw new Error("Vite consumer did not compile the RespondKit Tailwind source");
  }

  for (const { directory, name } of packages) {
    const installedPackageDirectory = join(consumerDirectory, "node_modules", ...name.split("/"));
    const packageJson = await readFile(join(installedPackageDirectory, "package.json"), "utf8");
    if (packageJson.includes("workspace:")) {
      throw new Error(`${directory} leaked a workspace dependency into its npm tarball`);
    }
    const installedManifest = JSON.parse(packageJson) as { license?: string };
    if (installedManifest.license !== "MIT") {
      throw new Error(`${directory} does not declare the MIT license in its npm tarball`);
    }
    await access(join(installedPackageDirectory, "LICENSE"));
  }

  console.log(
    "RespondKit npm tarballs passed clean-install, type, runtime, Vite, CSS, license, and manifest checks.",
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
