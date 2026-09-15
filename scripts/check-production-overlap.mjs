import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = JSON.parse(await readFile(path.join(root, "index.json"), "utf8"));
const productionURL = "https://raw.githubusercontent.com/Synthetiq-HQ/synthetiq-manga-sources/main/index.json";
const response = await fetch(productionURL, { headers: { Accept: "application/json" } });
assert.equal(response.ok, true, `production catalogue request failed with HTTP ${response.status}`);
const production = await response.json();
const productionIDs = new Set((production.modules || []).map((entry) => entry.id));
const overlap = local.modules.map((entry) => entry.id).filter((id) => productionIDs.has(id));
assert.deepEqual(overlap, [], `promoted modules must be removed from this test catalogue: ${overlap.join(", ")}`);
console.log("No test modules overlap the production catalogue.");
