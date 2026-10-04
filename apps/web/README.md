# Documentation site

Edit guides in `content/docs/` and keep their order in `meta.json`. Pages use Markdown-compatible MDX with a title, description, and icon. Keep code examples aligned with the SDK exports and separate released functionality from implementation proposals.

Run from the repository root:

```sh
pnpm --dir apps/web dev
pnpm --dir apps/web docs:export
pnpm --dir apps/web test
pnpm --dir apps/web build
```

Development startup and production builds generate `/llms.txt`, `/llms-full.txt`, and `/docs-markdown/*.md` from those same guides. During a running dev session, rerun `docs:export` after editing a guide to refresh its Markdown copy. Generated files stay out of Git and are shipped as static assets with the site. Do not author a separate agent knowledge base.

The export validates navigation coverage and internal guide links; the test checks exported links and code examples. Website changes trigger workspace CI, including the production build. Preview and test documentation changes before deploying; building this site does not publish SDK packages or deploy the support API.
