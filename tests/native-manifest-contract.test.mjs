import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateNativeManifest } from "../scripts/native-manifest-contract.mjs";

const manifest = JSON.parse(await readFile(new URL("../modules/books-owned-pi-qa/manifest.json", import.meta.url), "utf8"));

test("published candidate satisfies the native manifest fields", () => {
  assert.doesNotThrow(() => validateNativeManifest(manifest));
});

test("missing required fields fail before publishing", () => {
  for (const key of ["universalLink", "legacyIDs", "capabilities", "limits", "entry", "icon", "attribution", "minimumAppVersion"]) {
    const incomplete = structuredClone(manifest);
    delete incomplete[key];
    assert.throws(() => validateNativeManifest(incomplete), key);
  }
});

test("edition metadata cannot invent a native capability", () => {
  assert.throws(() => validateNativeManifest({ ...manifest, capabilities: [...manifest.capabilities, "editions"] }));
});

test("content ratings match the native enum rather than marketing labels", () => {
  assert.doesNotThrow(() => validateNativeManifest({ ...manifest, contentRating: "safe" }));
  assert.throws(() => validateNativeManifest({ ...manifest, contentRating: "everyone" }));
  assert.throws(() => validateNativeManifest({ ...manifest, contentRating: "erotica" }));
});
