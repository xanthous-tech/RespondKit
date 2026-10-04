import { readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

export async function buildAgentDocs(contentDirectory: string) {
  const meta = JSON.parse(await readFile(path.join(contentDirectory, "meta.json"), "utf8")) as {
    pages: string[];
  };
  const files = (await readdir(contentDirectory)).filter((file) => file.endsWith(".mdx"));
  if (new Set(meta.pages).size !== files.length || meta.pages.length !== files.length) {
    throw new Error("Documentation navigation must include every page exactly once");
  }

  const pages = await Promise.all(
    meta.pages.map(async (slug) => {
      if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Invalid documentation slug: ${slug}`);
      const raw = await readFile(path.join(contentDirectory, `${slug}.mdx`), "utf8");
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
      const title = /^title: (.+)$/m.exec(match?.[1] ?? "")?.[1];
      const description = /^description: (.+)$/m.exec(match?.[1] ?? "")?.[1];
      if (!match || !title || !description)
        throw new Error(`Missing documentation metadata: ${slug}`);
      const body = (match[2] ?? "").trim();
      // These pages deliberately use Markdown-compatible MDX so agents get the
      // full text and code examples without depending on browser rendering.
      for (const link of body.matchAll(/\]\(\/docs(?:\/([a-z0-9-]+))?(?:#[^)]*)?\)/g)) {
        if (!meta.pages.includes(link[1] ?? "index")) {
          throw new Error(`Broken documentation link in ${slug}: ${link[0]}`);
        }
      }
      const markdown = body.replace(
        /\]\(\/docs(?:\/([a-z0-9-]+))?(#[^)]*)?\)/g,
        (_, target, anchor = "") => `](/docs-markdown/${target ?? "index"}.md${anchor})`,
      );
      return { slug, title, description, markdown };
    }),
  );

  const outputs = new Map<string, string>();
  const index = [
    "# RespondKit",
    "",
    "> Integration and operations documentation for React, React Native, SwiftUI, and Android clients.",
    "",
    "Read release availability before installing. Support-agent endpoints and UI localization are proposals unless a guide explicitly says they are available.",
    "",
    "## Guides",
    "",
    ...pages.map(
      (page) => `- [${page.title}](/docs-markdown/${page.slug}.md): ${page.description}`,
    ),
    "",
    "## Complete text",
    "",
    "- [All documentation](/llms-full.txt)",
    "",
  ];
  outputs.set("llms.txt", index.join("\n"));
  const full: string[] = [];
  for (const page of pages) {
    const text = `# ${page.title}\n\n${page.description}\n\n${page.markdown}\n`;
    outputs.set(`docs-markdown/${page.slug}.md`, text);
    full.push(text);
  }
  outputs.set("llms-full.txt", full.join("\n---\n\n"));
  return outputs;
}

export async function exportAgentDocs(root = webRoot) {
  const outputs = await buildAgentDocs(path.join(root, "content/docs"));
  const publicDirectory = path.join(root, "public");
  // Remove only this generator's directory, so deleted pages cannot remain live.
  await rm(path.join(publicDirectory, "docs-markdown"), { recursive: true, force: true });
  await mkdir(path.join(publicDirectory, "docs-markdown"), { recursive: true });
  await Promise.all(
    [...outputs].map(([name, text]) => writeFile(path.join(publicDirectory, name), text)),
  );
  return outputs.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Exported ${await exportAgentDocs()} agent documentation files`);
}
