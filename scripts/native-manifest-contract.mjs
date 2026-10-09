import assert from "node:assert/strict";

const capabilities = new Set([
  "popular", "latest", "search", "filters", "tags", "details", "chapters",
  "images", "imageRequest", "text", "resources", "discovery", "interactivePage",
  "downloadOnly", "audio",
]);

export function validateNativeManifest(manifest) {
  for (const key of ["id", "familyID", "name", "version", "minimumAppVersion", "language"]) {
    assert.equal(typeof manifest[key], "string", `Native manifest requires ${key}`);
    assert.ok(manifest[key].length > 0, `Native manifest requires nonempty ${key}`);
  }
  assert.ok(Array.isArray(manifest.legacyIDs), "Native manifest requires legacyIDs");
  assert.ok(manifest.legacyIDs.every((id) => typeof id === "string"));
  assert.equal(manifest.contractVersion, 1);
  assert.ok(["pageImages", "text", "publication", "audio"].includes(manifest.contentType));
  assert.ok(["safe", "suggestive", "unknown"].includes(manifest.contentRating));
  assert.ok(["stable", "beta"].includes(manifest.releaseTrack));
  assert.ok(["active", "disabled", "retired"].includes(manifest.status));
  for (const key of ["baseURL", "universalLink"]) {
    assert.equal(typeof manifest[key], "string", `Native manifest requires ${key}`);
    assert.equal(new URL(manifest[key]).protocol, "https:");
  }
  assert.equal(typeof manifest.attribution?.author, "string");
  assert.equal(new URL(manifest.attribution?.website).protocol, "https:");
  assert.ok(Array.isArray(manifest.allowedHosts) && manifest.allowedHosts.length > 0);
  assert.ok(manifest.allowedHosts.every((host) => typeof host === "string"));
  assert.ok(Array.isArray(manifest.capabilities), "Native manifest requires capabilities");
  assert.ok(manifest.capabilities.every((value) => capabilities.has(value)), "Unsupported native capability");
  for (const key of ["timeoutMilliseconds", "maxConcurrentRequests", "maxResponseBytes", "maxScriptBytes", "cacheTTLSeconds"]) {
    assert.ok(Number.isSafeInteger(manifest.limits?.[key]) && manifest.limits[key] >= 0,
      `Native manifest requires integer limit ${key}`);
  }
  for (const key of ["entry", "icon"]) {
    assert.equal(typeof manifest[key]?.path, "string", `Native manifest requires ${key}.path`);
    assert.match(manifest[key]?.sha256 ?? "", /^[a-f0-9]{64}$/i);
  }
}
