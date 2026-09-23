import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(await readFile(path.join(root, "index.json"), "utf8"));

if (index.modules.length === 0) {
  console.log("No staging candidate to test.");
} else {
  const manifestPath = index.modules[0].manifest.path;
  const slug = manifestPath.match(/^modules\/([a-z0-9-]+)\/manifest\.json$/)?.[1];
  if (!slug) throw new Error("Candidate has an invalid manifest path.");
  const testPath = path.join(root, "tests", `${slug}.test.mjs`);
  await stat(testPath);
  const result = spawnSync(process.execPath, ["--test", testPath], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
