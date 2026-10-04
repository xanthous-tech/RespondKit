/** Plan every package before publishing any, so a missing bootstrap cannot cause a partial npm release. */
export async function planNpmRelease({ version, artifacts, lookup }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error("Expected a stable semantic version");
  }
  const plan = [];
  for (const artifact of artifacts) {
    const metadata = await lookup(artifact.name);
    if (metadata === null) {
      throw new Error(
        `${artifact.name} is not on npm. Complete its authenticated first publication and trusted-publisher setup before releasing. See docs/npm-publishing.md.`,
      );
    }
    if (!metadata.versions || typeof metadata.versions !== "object") {
      throw new Error(`Invalid registry metadata for ${artifact.name}`);
    }
    const existing = metadata.versions[version];
    if (existing && existing.dist?.integrity !== artifact.integrity) {
      throw new Error(
        `${artifact.name}@${version} already exists with different or missing integrity. Use the original verified tarball; never overwrite a published version.`,
      );
    }
    plan.push({ ...artifact, action: existing ? "skip" : "publish" });
  }
  return plan;
}

/** Only a 404 means a package needs bootstrapping; outages/auth failures must fail closed. */
export async function lookupNpmPackage(name, request = fetch) {
  const response = await request(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${name}`);
  return response.json();
}
