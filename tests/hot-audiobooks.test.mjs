import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

async function loadModule(bridges) {
  const source = await readFile(new URL("../modules/hot-audiobooks/index.js", import.meta.url), "utf8");
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
  new vm.Script(source, { filename: "modules/hot-audiobooks/index.js" }).runInContext(context);
  return context.SynthetiqModule;
}

function response(body, headers = {}) {
  return {
    ok: true,
    status: 200,
    body,
    bodyDropped: false,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || "";
      },
    },
  };
}

function postFixture({ id, title, terms = ["Audio Book"], content }) {
  return {
    id,
    link: `https://hotaudiobooks.com/${id}-fixture/`,
    title: { rendered: title },
    excerpt: { rendered: `<p>${title} summary</p>` },
    content: { rendered: content },
    _embedded: {
      author: [{ name: "Fixture Author" }],
      "wp:term": [terms.map((name) => ({ name }))],
    },
  };
}

test("Hot Audiobooks extracts ordered public tracks and canonicalizes media URLs", async () => {
  const post = postFixture({
    id: 5255,
    title: "Fixture Texas Audiobook",
    content: [
      '<audio id="audio-5255-1"><source src="https://ipaudio.club/fixture/01.mp3?_=1" /></audio>',
      '<audio id="audio-5255-2"><source src="http://off-host.invalid/02.mp3" /></audio>',
      '<audio id="audio-5255-2"><a href="https://ipaudio.club/fixture/02.mp3?_=2">Track 2</a></audio>',
    ].join("\n"),
  });
  const module = await loadModule({
    fetchv2: async (url) => {
      if (String(url).includes("/posts?")) return response(JSON.stringify([post]), { "x-wp-totalpages": "1" });
      if (String(url).includes("/posts/5255?")) return response(JSON.stringify(post));
      throw new Error(`Unexpected Hot Audiobooks URL: ${url}`);
    },
  });

  const search = await module.searchResults("fixture", 1);
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].image, null);
  const details = await module.extractDetails(search.items[0].id);
  assert.equal(details.chapterCount, 2);
  const chapters = await module.extractChapters(details.id);
  assert.deepEqual(Array.from(chapters, (chapter) => chapter.number), [1, 2]);
  assert.deepEqual(Array.from(chapters, (chapter) => chapter.id), [
    "hot-audiobooks:track:5255:1",
    "hot-audiobooks:track:5255:2",
  ]);
  const audio = await module.extractAudio(chapters[0].id);
  assert.equal(audio.tracks[0].url, "https://ipaudio.club/fixture/01.mp3");
  assert.equal(audio.tracks[0].format, "mp3");
});

test("Hot Audiobooks excludes explicitly adult-labelled entries", async () => {
  const safe = postFixture({
    id: 5255,
    title: "Safe Fixture Audiobook",
    content: '<audio id="audio-5255-1"><source src="https://ipaudio.club/fixture/01.mp3" /></audio>',
  });
  const adult = postFixture({
    id: 5256,
    title: "Adult Fixture Audiobook",
    terms: ["Adults"],
    content: '<audio id="audio-5256-1"><source src="https://ipaudio.club/fixture/01.mp3" /></audio>',
  });
  const module = await loadModule({
    fetchv2: async (url) => {
      if (String(url).includes("/posts?")) return response(JSON.stringify([safe, adult]));
      if (String(url).includes("/posts/5256?")) return response(JSON.stringify(adult));
      throw new Error(`Unexpected safety-filter URL: ${url}`);
    },
  });
  const search = await module.searchResults("fixture", 1);
  assert.deepEqual(Array.from(search.items, (item) => item.title), ["Safe Fixture Audiobook"]);
  await assert.rejects(() => module.extractDetails("hot-audiobooks:post:5256"), /content-safety filter/i);
});

test("Hot Audiobooks declares a valid single staging module", async () => {
  const index = JSON.parse(await readFile(new URL("index.json", root), "utf8"));
  assert.deepEqual(index.modules.map((entry) => entry.id), ["hot-audiobooks"]);
  const manifest = JSON.parse(await readFile(new URL("modules/hot-audiobooks/manifest.json", root), "utf8"));
  assert.equal(manifest.contentType, "audio");
  assert.equal(manifest.contentRating, "suggestive");
  assert.ok(manifest.capabilities.includes("audio"));
});
