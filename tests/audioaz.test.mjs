import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

async function loadModule(bridges) {
  const source = await readFile(new URL("../modules/audioaz/index.js", import.meta.url), "utf8");
  const context = vm.createContext({
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    console,
    setTimeout,
    clearTimeout,
    ...bridges,
  });
  new vm.Script(source, { filename: "modules/audioaz/index.js" }).runInContext(context);
  return context.SynthetiqModule;
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    bodyDropped: false,
    headers: { get: () => "" },
  };
}

const searchHTML = `
  <a href="/en/archive/fixture-archive-book">
    <img src="https://f.audioaz.com/media/fixture.webp" alt="Fixture Archive Book" />
    <span>Fixture Archive Book</span>
  </a>`;

const detailsHTML = `
  <script type="application/ld+json">{"@type":"Audiobook","name":"Fixture Archive Book","author":{"name":"Fixture Author"},"image":"https://f.audioaz.com/media/fixture.webp","description":"Fixture description","inLanguage":"en","genre":["Fantasy"]}</script>
  <audio>
    <source src="https://archive.org/download/fixture-archive-book/01.mp3" type="audio/mpeg" />
    <source src="https://api.audioaz.com/v1/stream?token=fixture-secret" type="audio/mpeg" />
  </audio>`;

test("AudioAZ extracts a public archive audiobook and rejects tokenized media", async () => {
  const calls = [];
  const module = await loadModule({
    fetchv2: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/en/search?")) return response(searchHTML);
      if (String(url).includes("/en/archive/fixture-archive-book")) return response(detailsHTML);
      throw new Error(`Unexpected AudioAZ URL: ${url}`);
    },
  });

  const search = await module.searchResults("fixture", 1);
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].id, "https://audioaz.com/en/archive/fixture-archive-book");
  const details = await module.extractDetails(search.items[0].id);
  assert.equal(details.title, "Fixture Archive Book");
  const chapters = await module.extractChapters(details.id);
  assert.equal(chapters.length, 1);
  const audio = await module.extractAudio(chapters[0].id);
  assert.equal(audio.tracks[0].url, "https://archive.org/download/fixture-archive-book/01.mp3");
  assert.equal(audio.tracks[0].format, "mp3");
  assert.equal(calls.some((url) => url.includes("api.audioaz.com")), false);
});

test("AudioAZ excludes explicitly adult-labelled entries and off-host pages", async () => {
  const adultSearch = '<a href="/en/archive/adult-book"><span>Adult Fixture Audiobook</span></a>';
  const adultDetails = '<script type="application/ld+json">{"@type":"Audiobook","name":"Safe Title","genre":["Adult"]}</script><audio><source src="https://archive.org/download/adult-book/01.mp3" /></audio>';
  const module = await loadModule({
    fetchv2: async (url) => {
      if (String(url).includes("/en/search?")) return response(adultSearch);
      if (String(url).includes("/en/archive/adult-book")) return response(adultDetails);
      throw new Error(`Unexpected AudioAZ safety URL: ${url}`);
    },
  });
  const search = await module.searchResults("adult", 1);
  assert.equal(search.items.length, 0);
  await assert.rejects(() => module.extractDetails("https://audioaz.com/en/archive/adult-book"), /content-safety filter/i);
  await assert.rejects(() => module.extractDetails("https://example.com/en/archive/fixture"), /Invalid AudioAZ audiobook page/i);
});

test("AudioAZ declares the single staging module", async () => {
  const index = JSON.parse(await readFile(new URL("index.json", root), "utf8"));
  assert.deepEqual(index.modules.map((entry) => entry.id), ["audioaz"]);
  const manifest = JSON.parse(await readFile(new URL("modules/audioaz/manifest.json", root), "utf8"));
  assert.equal(manifest.contentType, "audio");
  assert.equal(manifest.contentRating, "suggestive");
  assert.ok(manifest.capabilities.includes("audio"));
});
