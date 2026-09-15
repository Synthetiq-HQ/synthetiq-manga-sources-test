import { readFile } from "node:fs/promises";
import vm from "node:vm";

const MODULES = [
  { slug: "goldenaudiobooks", query: "game of thrones", pick: /game of thrones/i },
  { slug: "hot-audiobooks", query: "eyes of texas", pick: /eyes of texas/i },
  { slug: "audioaz", query: "1984", pick: /1984|nineteen eighty-four/i },
  { slug: "audiobooks-for-your-soul", query: "crown of swords", pick: /crown of swords/i },
  { slug: "audiobb", query: "terran accord", pick: /terran accord/i },
];

function responseFrom(response, body) {
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body,
    bodyDropped: false,
    dropReason: null,
    contentType: response.headers.get("content-type") || "",
  };
}

async function fetchv2(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      headers: { ...headers, "User-Agent": "SynthetiqBooks-audio-prototype/0.1 (metadata probe)" },
      redirect: "follow",
      signal: controller.signal,
    });
    return responseFrom(response, await response.text());
  } finally {
    clearTimeout(timer);
  }
}

async function loadModule(slug) {
  const source = await readFile(new URL(`../modules/${slug}/index.js`, import.meta.url), "utf8");
  const context = vm.createContext({ URL, URLSearchParams, TextDecoder, TextEncoder, console, setTimeout, clearTimeout, fetchv2 });
  context.globalThis = context;
  new vm.Script(source, { filename: `modules/${slug}/index.js` }).runInContext(context);
  return context.SynthetiqModule;
}

async function probe(config) {
  const module = await loadModule(config.slug);
  const search = await module.searchResults(config.query, 1);
  const selected = search.items.find((item) => config.pick.test(item.title)) || search.items[0];
  if (!selected) throw new Error(`No live search result for ${config.query}.`);
  const details = await module.extractDetails(selected.id);
  const chapters = await module.extractChapters(details.id);
  const audio = await module.extractAudio(chapters[0].id);
  const firstTrack = audio.tracks[0];
  return {
    slug: config.slug,
    searchItems: search.items.length,
    hasMore: Boolean(search.hasMore),
    selectedTitle: details.title,
    chapterCount: chapters.length,
    trackCount: audio.tracks.length,
    format: firstTrack?.format || null,
    mediaHost: firstTrack?.url ? new URL(firstTrack.url).hostname : null,
  };
}

for (const config of MODULES) {
  try {
    console.log(JSON.stringify({ ok: true, ...(await probe(config)) }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, slug: config.slug, error: String(error?.message || error) }));
  }
}
