import assert from "node:assert/strict";
import { test } from "node:test";
import { lookupNpmPackage, planNpmRelease } from "./lib/npm-release.mjs";

const artifacts = ["protocol", "api-client", "react", "react-native"].map((name) => ({
  name: `@respondkit/${name}`,
  integrity: `sha512-${name}`,
  tarball: `/tmp/${name}.tgz`,
}));
const version = "0.6.0";

await test("new versions retain dependency order", async () => {
  const plan = await planNpmRelease({
    version,
    artifacts,
    lookup: async () => ({ versions: { "0.5.3": {} } }),
  });
  assert.deepEqual(
    plan.map((item) => [item.name, item.action]),
    artifacts.map((item) => [item.name, "publish"]),
  );
});
await test("a manually bootstrapped React Native artifact is skipped only when bytes match", async () => {
  const plan = await planNpmRelease({
    version,
    artifacts,
    lookup: async (name) => ({
      versions: name.endsWith("react-native")
        ? {
            [version]: { dist: { integrity: artifacts[3].integrity } },
          }
        : {},
    }),
  });
  assert.deepEqual(
    plan.map((item) => item.action),
    ["publish", "publish", "publish", "skip"],
  );
});
await test("a partial previous release can resume from the original tarballs", async () => {
  const plan = await planNpmRelease({
    version,
    artifacts,
    lookup: async (name) => ({
      versions: {
        [version]: { dist: { integrity: artifacts.find((item) => item.name === name).integrity } },
      },
    }),
  });
  assert.ok(plan.every((item) => item.action === "skip"));
});
await test("missing package rejects the whole plan before any publishing", async () => {
  await assert.rejects(
    planNpmRelease({
      version,
      artifacts,
      lookup: async (name) => (name.endsWith("react-native") ? null : { versions: {} }),
    }),
    /first publication/,
  );
});
await test("existing versions with different or missing integrity are never skipped", async () => {
  for (const existing of [{ dist: { integrity: "sha512-wrong" } }, {}]) {
    await assert.rejects(
      planNpmRelease({
        version,
        artifacts,
        lookup: async () => ({ versions: { [version]: existing } }),
      }),
      /different or missing integrity/,
    );
  }
});
await test("invalid version and registry metadata fail before a plan is returned", async () => {
  await assert.rejects(
    planNpmRelease({ version: "0.6.0-rc.1", artifacts, lookup: async () => ({ versions: {} }) }),
    /stable semantic version/,
  );
  await assert.rejects(
    planNpmRelease({ version, artifacts, lookup: async () => ({}) }),
    /Invalid registry metadata/,
  );
});
await test("registry 404 is distinguished from auth failures and outages", async () => {
  assert.equal(
    await lookupNpmPackage(
      "@respondkit/react-native",
      async () => new Response(null, { status: 404 }),
    ),
    null,
  );
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      lookupNpmPackage("@respondkit/react-native", async () => new Response(null, { status })),
      new RegExp(String(status)),
    );
  }
});
await test("a network failure is propagated, not treated as an unpublished package", async () => {
  await assert.rejects(
    lookupNpmPackage("@respondkit/react-native", async () => {
      throw new Error("network unavailable");
    }),
    /network unavailable/,
  );
});
