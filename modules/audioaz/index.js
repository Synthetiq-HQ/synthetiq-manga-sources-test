"use strict";

(() => {
  const BASE_URL = "https://audioaz.com";
  const PAGE_SIZE = 20;
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  const SOURCE_HOSTS = new Set(["audioaz.com"]);
  const MEDIA_HOSTS = new Set(["archive.org"]);
  const IMAGE_HOSTS = new Set(["audioaz.com", "f.audioaz.com"]);

  function text(value) { return String(value == null ? "" : value).trim(); }
  function decodeHTML(value) {
    return text(value).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
  }
  function stripHTML(value) { return decodeHTML(value).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim(); }
  function safeURL(value, hosts) {
    try {
      const url = new URL(decodeHTML(value), BASE_URL);
      if (url.protocol !== "https:") return null;
      const host = url.hostname.toLowerCase();
      if (![...hosts].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return null;
      url.hash = "";
      return url.toString();
    } catch (_) { return null; }
  }
  function attribute(tag, name) { return new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] || ""; }
  function responseBody(response) { if (response?.bodyDropped) throw new Error("AudioAZ response exceeded the module limit."); return typeof response?.body === "string" ? response.body : ""; }
  async function requestHTML(url) {
    if (typeof globalThis.fetchv2 !== "function") throw new Error("AudioAZ requires fetchv2.");
    const response = await globalThis.fetchv2(url, { Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" }, "GET", null, { followRedirects: true, maxBytesHint: MAX_RESPONSE_BYTES, responseClass: "html" });
    const status = Number(response?.status || 0);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) throw new Error(`AudioAZ request failed with HTTP ${status || "error"}.`);
    return responseBody(response);
  }
  function canonicalPage(value) {
    const url = safeURL(value, SOURCE_HOSTS);
    if (!url || !new URL(url).pathname.startsWith("/en/archive/")) throw new Error("Invalid AudioAZ archive page.");
    return url;
  }
  function chapterID(pageURL) { return `audioaz:chapter:${encodeURIComponent(canonicalPage(pageURL))}`; }
  function pageFromChapterID(value) {
    const match = text(value).match(/^audioaz:chapter:(.+)$/i);
    if (!match) throw new Error("Invalid AudioAZ chapter ID.");
    return canonicalPage(decodeURIComponent(match[1]));
  }
  function meta(html, key, attributeName = "content") {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(html || "").match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+${attributeName}=["']([^"']*)["']`, "i"))
      || String(html || "").match(new RegExp(`<meta[^>]+${attributeName}=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"));
    return match ? stripHTML(match[1]) : "";
  }
  function parseJSONLD(html) {
    const scripts = [...String(html || "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(decodeHTML(script[1]));
        const values = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [])];
        const audiobook = values.find((value) => String(value?.["@type"] || "").toLowerCase().includes("audiobook"));
        if (audiobook) return audiobook;
      } catch (_) { /* Ignore unrelated JSON-LD blocks. */ }
    }
    return {};
  }
  function mediaSources(html) {
    const values = [];
    for (const block of [...String(html || "").matchAll(/<audio\b[^>]*>([\s\S]*?)<\/audio>/gi)]) {
      for (const source of [...block[1].matchAll(/<(?:source|a)\b([^>]*)>/gi)]) {
        const value = attribute(source[1] || "", "src") || attribute(source[1] || "", "href");
        const url = safeURL(value, MEDIA_HOSTS);
        if (url) values.push({ url, type: attribute(source[1] || "", "type") });
      }
    }
    const unique = [...new Map(values.map((value) => [value.url, value])).values()];
    return unique.sort((left, right) => {
      const rank = (value) => /\.mp3(?:\?|$)/i.test(value.url) ? 0 : /\.(?:m4a|m4b|mp4)(?:\?|$)/i.test(value.url) ? 1 : 2;
      return rank(left) - rank(right);
    });
  }
  function pageTitle(html, json) { return stripHTML(json?.name) || meta(html, "og:title") || stripHTML((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]) || "AudioAZ audiobook"; }
  function imageURL(html, json) { return safeURL(json?.image || meta(html, "og:image"), IMAGE_HOSTS); }
  function authors(json) {
    const author = json?.author;
    const values = Array.isArray(author) ? author : author ? [author] : [];
    return [...new Set(values.map((value) => stripHTML(value?.name || value)).filter(Boolean))];
  }
  function archiveItems(html) {
    const output = []; const seen = new Set();
    for (const match of [...String(html || "").matchAll(/<a\b([^>]*href=["'][^"']*\/en\/archive\/[^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi)]) {
      const open = match[1] || "";
      const url = safeURL(attribute(open, "href"), SOURCE_HOSTS);
      if (!url || seen.has(url)) continue;
      const inner = match[2] || "";
      const image = safeURL(attribute((/<img\b([^>]*)>/i.exec(inner) || [])[1] || "", "src") || attribute((/<img\b([^>]*)>/i.exec(inner) || [])[1] || "", "data-src"), IMAGE_HOSTS);
      const title = stripHTML(attribute(open, "title") || attribute(open, "aria-label") || inner) || new URL(url).pathname.split("/").pop();
      seen.add(url); output.push({ id: url, href: url, url, title, image, description: "", author: "", genres: [] });
    }
    return output;
  }
  async function searchResults(query, page = 1) {
    const requestedPage = Math.max(1, Number(page) || 1);
    const value = typeof query === "string" ? query.trim() : "";
    const url = new URL(value && !value.startsWith("__feed:") ? `${BASE_URL}/en/search` : `${BASE_URL}/en/audiobooks`);
    if (value && !value.startsWith("__feed:")) url.searchParams.set("q", value.slice(0, 120));
    url.searchParams.set("page", String(requestedPage));
    if (!value || value.startsWith("__feed:")) url.searchParams.set("sort", "popular");
    const html = await requestHTML(url.toString());
    const items = archiveItems(html);
    const hasNext = /(?:[?&]page=|\/page\/)["'][^>]*>\s*(?:Next|›|»)/i.test(html) || new RegExp(`[?&]page=${requestedPage + 1}(?:&|["'])`, "i").test(html);
    return { items, hasMore: hasNext || items.length === PAGE_SIZE };
  }
  async function extractDetails(id) {
    const page = canonicalPage(id); const html = await requestHTML(page); const json = parseJSONLD(html); const authorsList = authors(json);
    return { id: page, href: page, url: page, title: pageTitle(html, json), image: imageURL(html, json), description: stripHTML(json?.description) || meta(html, "description"), author: authorsList.join(", "), authors: authorsList, genres: Array.isArray(json?.genre) ? json.genre.map(stripHTML).filter(Boolean) : [], status: "Completed" };
  }
  async function extractChapters(id) {
    const page = canonicalPage(id); const html = await requestHTML(page); const sources = mediaSources(html);
    if (!sources.length) throw new Error("AudioAZ archive has no direct public archive.org audio source.");
    const json = parseJSONLD(html); const title = pageTitle(html, json);
    return [{ id: chapterID(page), href: page, url: chapterID(page), title: `Full audiobook — ${title}`, number: 1, language: text(json?.inLanguage) || "en" }];
  }
  async function extractAudio(id) {
    const page = pageFromChapterID(id); const html = await requestHTML(page); const source = mediaSources(html)[0];
    if (!source) throw new Error("AudioAZ archive has no direct public archive.org audio source.");
    const json = parseJSONLD(html); const title = pageTitle(html, json); const extension = /\.(m4a|m4b|mp4|opus)(?:\?|$)/i.exec(source.url)?.[1]?.toLowerCase() || "mp3";
    return { tracks: [{ id, title, url: source.url, format: extension === "mp4" ? "m4a" : extension, fileName: `audioaz-${encodeURIComponent(new URL(page).pathname.split("/").pop())}.${extension}`, part: 1, track: 1, language: text(json?.inLanguage) || "en" }] };
  }
  async function discoveryHome() { const feed = await searchResults("__feed:popular", 1); return { sections: [{ id: "popular", title: "Popular audiobooks", items: feed.items }] }; }
  async function discoveryFeed(feedID, page = 1) { if (!["popular", "latest", "catalogue"].includes(String(feedID || "popular").toLowerCase())) throw new Error("AudioAZ feed is not supported."); return searchResults("__feed:popular", page); }
  const handlers = { searchResults, extractDetails, extractChapters, extractAudio, discoveryHome, discoveryFeed };
  globalThis.SynthetiqModule = handlers; Object.assign(globalThis, handlers);
})();
