import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { validateNativeManifest } from "./native-manifest-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hashPattern = /^[a-f0-9]{64}$/i;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const handlersByType = {
  pageImages: ["searchResults", "extractDetails", "extractChapters", "extractImages"],
  text: ["searchResults", "extractDetails", "extractChapters", "extractText"],
  publication: ["searchResults", "extractDetails", "extractResources"],
  audio: ["searchResults", "extractDetails", "extractChapters", "extractAudio"],
};

async function readJSON(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function sha256(relativePath) {
  return createHash("sha256").update(await readFile(path.join(root, relativePath))).digest("hex");
}

async function assertSafeAsset(asset, label) {
  assert.ok(asset && typeof asset.path === "string", `${label} path missing`);
  assert.equal(path.isAbsolute(asset.path), false, `${label} path must be relative`);
  assert.equal(asset.path.includes(".."), false, `${label} path escapes repository`);
  assert.ok(hashPattern.test(asset.sha256 || ""), `${label} hash missing`);
  await stat(path.join(root, asset.path));
  assert.equal((await sha256(asset.path)), asset.sha256.toLowerCase(), `${label} hash mismatch`);
}

async function loadModule(slug) {
  const source = await readFile(path.join(root, "modules", slug, "index.js"), "utf8");
  const context = vm.createContext({ URL, URLSearchParams, TextDecoder, TextEncoder, console, setTimeout, clearTimeout });
  new vm.Script(source, { filename: `modules/${slug}/index.js` }).runInContext(context);
  return context.SynthetiqModule;
}

const index = await readJSON("index.json");
assert.equal(index.schemaVersion, 1, "unsupported catalogue schema");
assert.equal(new URL(index.repository.homepage).hostname, "github.com");
assert.equal(new URL(index.repository.universalLink).protocol, "https:");
assert.ok(Array.isArray(index.modules) && index.modules.length <= 1, "test catalogue must have at most one candidate");
const expectedSlugs = index.modules.map((entry) => {
  const match = String(entry.manifest?.path || "").match(/^modules\/([a-z0-9-]+)\/manifest\.json$/);
  assert.ok(match, `${entry.id} has an invalid manifest path`);
  return match[1];
});

const moduleDirectories = (await readdir(path.join(root, "modules"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.deepEqual(moduleDirectories, [...expectedSlugs].sort(), "module tree contains non-test modules");

for (const [position, entry] of index.modules.entries()) {
  const slug = expectedSlugs[position];
  for (const key of ["id", "familyID"]) {
    assert.match(entry[key], /^[a-z0-9][a-z0-9._-]{0,127}$/, `${entry.id} invalid ${key}`);
  }
  assert.match(entry.version, versionPattern);
  assert.ok(handlersByType[entry.contentType], `${entry.id} has unsupported content type`);
  assert.equal(entry.status, "active");
  const manifest = await readJSON(entry.manifest.path);
  validateNativeManifest(manifest);
  for (const key of ["id", "familyID", "name", "version", "language", "contentType", "contentRating", "releaseTrack", "status"]) {
    assert.equal(manifest[key], entry[key], `${entry.id} manifest/index mismatch for ${key}`);
  }
  assert.equal(manifest.contractVersion, 1);
  assert.equal(manifest.entry.path, `modules/${slug}/index.js`);
  assert.equal(manifest.icon.path, `modules/${slug}/icon.png`);
  assert.equal(entry.icon.path, manifest.icon.path);
  assert.equal(new URL(manifest.baseURL).protocol, "https:");
  assert.ok(manifest.allowedHosts.includes(new URL(manifest.baseURL).hostname), `${entry.id} base host missing from allowlist`);
  assert.ok(manifest.limits.timeoutMilliseconds >= 1000 && manifest.limits.timeoutMilliseconds <= 30000);
  assert.ok(manifest.limits.maxConcurrentRequests >= 1 && manifest.limits.maxConcurrentRequests <= 4);
  assert.ok(manifest.limits.maxResponseBytes >= 1024 && manifest.limits.maxResponseBytes <= 16 * 1024 * 1024);
  await assertSafeAsset(manifest.entry, `${entry.id} entry`);
  await assertSafeAsset(manifest.icon, `${entry.id} manifest icon`);
  await assertSafeAsset(entry.manifest, `${entry.id} catalogue manifest`);
  await assertSafeAsset(entry.icon, `${entry.id} catalogue icon`);
  const icon = await readFile(path.join(root, manifest.icon.path));
  assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${entry.id} icon must be PNG`);
  const module = await loadModule(slug);
  for (const handler of handlersByType[entry.contentType]) {
    assert.equal(typeof module[handler], "function", `${entry.id} missing ${handler}`);
  }
}

console.log(`Validated ${index.modules.length} test modules, assets, hashes, and content handlers.`);
