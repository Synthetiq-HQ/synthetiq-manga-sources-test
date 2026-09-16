import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadModule(slug, bridges) {
  const source = await readFile(new URL(`../modules/${slug}/index.js`, import.meta.url), "utf8");
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
  context.globalThis = context;
  new vm.Script(source, { filename: `modules/${slug}/index.js` }).runInContext(context);
  assert.equal(typeof context.SynthetiqModule, "object", `${slug} must publish SynthetiqModule`);
  return context.SynthetiqModule;
}

function response(body, options = {}) {
  return {
    status: options.status || 200,
    ok: (options.status || 200) >= 200 && (options.status || 200) < 300,
    headers: options.headers || {},
    body,
    bodyDropped: false,
    dropReason: null,
    contentType: options.contentType || "text/html",
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function postFixture({ id, link, title, author, content, image, terms = ["Fantasy", "Audio Book"] }) {
  return {
    id,
    link,
    title: { rendered: title },
    excerpt: { rendered: `<p>${title} summary</p>` },
    content: { rendered: content },
    _embedded: {
      author: author ? [{ name: author }] : [],
      "wp:featuredmedia": image ? [{ source_url: image }] : [],
      "wp:term": [terms.map((name) => ({ name }))],
    },
  };
}

async function exerciseWordPressModule({ slug, apiBase, baseURL, idPrefix, postID, title, audioHost }) {
  const postURL = `${baseURL}/fixture-audiobook/`;
  const content = [
    `<audio id="audio-${postID}-1"><source type="audio/mpeg" src="${audioHost}/fixture/01.mp3?_=1" /></audio>`,
    `<audio id="audio-${postID}-2"><source type="audio/mpeg" src="http://off-host.invalid/02.mp3" /></audio>`,
    `<audio id="audio-${postID}-2"><source type="audio/mpeg" src="${audioHost}/fixture/02.mp3?_=2" /></audio>`,
  ].join("\n");
  const post = postFixture({
    id: postID,
    link: postURL,
    title,
    author: "Fixture Author",
    image: `${baseURL}/wp-content/uploads/fixture.jpg`,
    content,
  });
  const calls = [];
  const module = await loadModule(slug, {
    fetchv2: async (url) => {
      calls.push(String(url));
      if (String(url).includes(`${apiBase}/posts?`)) return response(JSON.stringify([post]), { contentType: "application/json" });
      if (String(url).includes(`${apiBase}/posts/${postID}`)) return response(JSON.stringify(post), { contentType: "application/json" });
      throw new Error(`Unexpected ${slug} URL: ${url}`);
    },
  });
  const search = await module.searchResults("fixture", 1);
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].title, title);
  const details = await module.extractDetails(search.items[0].id);
  assert.equal(details.author, "Fixture Author");
  assert.equal(details.chapterCount, 2);
  const chapters = await module.extractChapters(search.items[0].id);
  assert.deepEqual(Array.from(chapters, (chapter) => chapter.number), [1, 2]);
  const audio = await module.extractAudio(chapters[1].id);
  assert.equal(audio.tracks.length, 1);
  assert.match(audio.tracks[0].url, new RegExp(`^${audioHost.replace(".", "\\.")}`));
  if (slug === "goldenaudiobooks") assert.equal(audio.tracks[0].url, `${audioHost}/fixture/02.mp3`);
  assert.equal(audio.tracks[0].format, "mp3");
  assert.ok(calls.some((url) => url.includes("_embed=1")));
  const discovery = await module.discoveryHome();
  assert.equal(discovery.sections[0].items.length, 1);
  assert.equal(idPrefix, chapters[0].id.split(":")[0]);
}

test("Goldenaudiobooks prototype handles WordPress search, details, complete audio tracks, and host rejection", async () => {
  await exerciseWordPressModule({
    slug: "goldenaudiobooks",
    apiBase: "https://goldenaudiobooks.com/wp-json/wp/v2",
    baseURL: "https://goldenaudiobooks.com",
    idPrefix: "goldenaudiobooks",
    postID: 2952,
    title: "Fixture Game Audiobook",
    audioHost: "https://ipaudio.club",
  });
});

test("Goldenaudiobooks excludes explicitly adult-labelled catalogue entries", async () => {
  const safePost = postFixture({
    id: 2952,
    link: "https://goldenaudiobooks.com/safe-audiobook/",
    title: "Safe Fixture Audiobook",
    author: "Fixture Author",
    image: "https://goldenaudiobooks.com/wp-content/uploads/safe.jpg",
    content: '<audio id="audio-2952-1"><source src="https://ipaudio.club/fixture/01.mp3" /></audio>',
  });
  const adultPost = postFixture({
    id: 2953,
    link: "https://goldenaudiobooks.com/adult-audiobook/",
    title: "Adult Fixture Audiobook",
    author: "Fixture Author",
    image: "https://goldenaudiobooks.com/wp-content/uploads/adult.jpg",
    terms: ["Adults"],
    content: '<audio id="audio-2953-1"><source src="https://ipaudio.club/fixture/01.mp3" /></audio>',
  });
  const module = await loadModule("goldenaudiobooks", {
    fetchv2: async (url) => {
      if (String(url).includes("/posts?")) return response(JSON.stringify([safePost, adultPost]), { contentType: "application/json" });
      if (String(url).includes("/posts/2953")) return response(JSON.stringify(adultPost), { contentType: "application/json" });
      throw new Error(`Unexpected safety-filter URL: ${url}`);
    },
  });
  const search = await module.searchResults("fixture", 1);
  assert.deepEqual(Array.from(search.items, (item) => item.title), ["Safe Fixture Audiobook"]);
  await assert.rejects(() => module.extractDetails("goldenaudiobooks:post:2953"), /content-safety filter/i);
});

test("Hot Audiobooks prototype handles WordPress search, details, and complete audio tracks", async () => {
  await exerciseWordPressModule({
    slug: "hot-audiobooks",
    apiBase: "https://hotaudiobooks.com/wp-json/wp/v2",
    baseURL: "https://hotaudiobooks.com",
    idPrefix: "hot-audiobooks",
    postID: 5255,
    title: "Fixture Texas Audiobook",
    audioHost: "https://ipaudio.club",
  });
});

test("AudioAZ prototype uses archive pages and rejects the tokenized audio service", async () => {
  const searchHTML = `
    <a href="/en/archive/fixture-archive-book">
      <img src="https://f.audioaz.com/media/fixture.webp" alt="Fixture Archive Book" />
    </a>`;
  const detailsHTML = `
    <script type="application/ld+json">{"@type":"Audiobook","name":"Fixture Archive Book","author":{"name":"Fixture Author"},"image":"https://f.audioaz.com/media/fixture.webp","description":"Fixture description","inLanguage":"en"}</script>
    <audio><source src="https://archive.org/download/fixture-archive-book/01.mp3" type="audio/mpeg"/><source src="https://api.audioaz.com/v1/stream?token=fixture-secret" type="audio/mpeg"/></audio>`;
  const calls = [];
  const module = await loadModule("audioaz", {
    fetchv2: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/en/search?")) return response(searchHTML);
      if (String(url).includes("/en/audiobooks?")) return response(searchHTML);
      if (String(url).includes("/en/archive/fixture-archive-book")) return response(detailsHTML);
      throw new Error(`Unexpected AudioAZ URL: ${url}`);
    },
  });
  const search = await module.searchResults("fixture", 1);
  assert.equal(search.items[0].id, "https://audioaz.com/en/archive/fixture-archive-book");
  const details = await module.extractDetails(search.items[0].id);
  assert.equal(details.title, "Fixture Archive Book");
  const chapters = await module.extractChapters(details.id);
  assert.equal(chapters.length, 1);
  const audio = await module.extractAudio(chapters[0].id);
  assert.equal(audio.tracks[0].url, "https://archive.org/download/fixture-archive-book/01.mp3");
  assert.equal(calls.some((url) => url.includes("api.audioaz.com")), false);
});

test("Audiobooks For Your Soul prototype parses playlist chapters and uses pagev2 for the public player", async () => {
  const productURL = "https://ezaudiobookforsoul.com/audiobook/fixture-audiobook/";
  const playlist = `
    <div class="simp-playlist"><ul>
      <span class="simp-source" data-src="opaque-one"><span class="simp-desc">Fixture Audiobook</span>Chapter 1</span>
      <span class="simp-source" data-src="opaque-two"><span class="simp-desc">Fixture Audiobook</span>Chapter 2</span>
    </ul></div>`;
  const product = postFixture({ id: 3235, link: productURL, title: "Fixture Soul Audiobook", author: "Fixture Author", image: "https://ezaudiocdn.b-cdn.net/fixture.jpg", content: playlist });
  const pageHTML = `<meta property="og:image" content="https://ezaudiocdn.b-cdn.net/fixture.jpg"><a href="/authors/fixture-author/">Fixture Author</a>${playlist}`;
  const pageCalls = [];
  const module = await loadModule("audiobooks-for-your-soul", {
    fetchv2: async (url) => {
      if (String(url).includes("/product?")) return response(JSON.stringify([product]), { contentType: "application/json" });
      if (String(url).includes("/product/3235")) return response(JSON.stringify(product), { contentType: "application/json" });
      if (String(url) === productURL) return response(pageHTML);
      throw new Error(`Unexpected Soul URL: ${url}`);
    },
    pagev2: async (task) => {
      pageCalls.push(task);
      assert.equal(task.url, productURL);
      assert.equal(task.waitForSelector, "audio source[src]");
      const url = task.actionScript.includes("[1]")
        ? "https://ezaudiocdn.b-cdn.net/audio/fixture-02.mp3"
        : "https://ezaudiocdn.b-cdn.net/audio/fixture-01.mp3";
      return { evaluatedData: JSON.stringify({ url }) };
    },
  });
  const search = await module.searchResults("fixture", 1);
  const details = await module.extractDetails(search.items[0].id);
  assert.equal(details.chapterCount, 2);
  const chapters = await module.extractChapters(details.id);
  assert.deepEqual(Array.from(chapters, (chapter) => chapter.number), [1, 2]);
  const audio = await module.extractAudio(chapters[1].id);
  assert.equal(audio.tracks[0].url, "https://ezaudiocdn.b-cdn.net/audio/fixture-02.mp3");
  assert.equal(pageCalls.length, 1);
});

test("AudioBB prototype parses direct m4b files and ignores download-page links", async () => {
  const post = postFixture({
    id: 49114,
    link: "https://audiobb.com/index.php/2026/09/15/fixture-audiobook/",
    title: "Fixture AudioBB Book",
    author: "Fixture Author",
    image: "https://audiobb.com/wp-content/uploads/fixture.jpg",
    content: [
      '<a href="https://rapidgator.net/file/fixture/Fixture.m4b.html">Rapidgator page</a>',
      '<a href="https://uploady.io/fixture/Fixture.m4b">Direct m4b</a>',
    ].join("\n"),
  });
  const module = await loadModule("audiobb", {
    fetchv2: async (url) => {
      if (String(url).includes("/posts?")) return response(JSON.stringify([post]), { contentType: "application/json" });
      if (String(url).includes("/posts/49114")) return response(JSON.stringify(post), { contentType: "application/json" });
      throw new Error(`Unexpected AudioBB URL: ${url}`);
    },
  });
  const search = await module.searchResults("fixture", 1);
  const chapters = await module.extractChapters(search.items[0].id);
  assert.equal(chapters.length, 1);
  const audio = await module.extractAudio(chapters[0].id);
  assert.equal(audio.tracks[0].format, "m4b");
  assert.equal(audio.tracks[0].url, "https://uploady.io/fixture/Fixture.m4b");
});

test("All audiobook prototypes are present in the test catalogue", async () => {
  const slugs = ["goldenaudiobooks", "hot-audiobooks", "audioaz", "audiobooks-for-your-soul", "audiobb"];
  const index = JSON.parse(await readFile(new URL("../index.json", import.meta.url), "utf8"));
  assert.deepEqual(index.modules.map((entry) => entry.id), slugs);
  for (const slug of slugs) {
    const manifest = JSON.parse(await readFile(new URL(`../modules/${slug}/manifest.json`, import.meta.url), "utf8"));
    assert.equal(manifest.contentType, "audio");
    assert.ok(manifest.capabilities.includes("audio"));
    assert.equal(manifest.status, "active");
    if (slug === "goldenaudiobooks") assert.equal(manifest.contentRating, "suggestive");
    const entryBytes = await readFile(new URL(`../${manifest.entry.path.replaceAll("\\", "/")}`, import.meta.url));
    const iconBytes = await readFile(new URL(`../${manifest.icon.path.replaceAll("\\", "/")}`, import.meta.url));
    assert.equal(manifest.entry.sha256.toLowerCase(), sha256(entryBytes));
    assert.equal(manifest.icon.sha256.toLowerCase(), sha256(iconBytes));
  }
});
