"use strict";

(() => {
  const BASE_URL = "https://audiobb.com";
  const API_URL = `${BASE_URL}/index.php/wp-json/wp/v2`;
  const PAGE_SIZE = 20;
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  const SOURCE_HOSTS = new Set(["audiobb.com"]);
  const MEDIA_HOSTS = new Set(["audiobb.com", "uploady.io", "rapidgator.net"]);

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
  function responseBody(response) { if (response?.bodyDropped) throw new Error("AudioBB response exceeded the module limit."); return typeof response?.body === "string" ? response.body : ""; }
  function header(response, name) {
    if (typeof response?.headers?.get === "function") return response.headers.get(name);
    const key = Object.keys(response?.headers || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key ? response.headers[key] : "";
  }
  async function requestJSON(url) {
    if (typeof globalThis.fetchv2 !== "function") throw new Error("AudioBB requires fetchv2.");
    const response = await globalThis.fetchv2(url, { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" }, "GET", null, { followRedirects: true, maxBytesHint: MAX_RESPONSE_BYTES, responseClass: "json" });
    const status = Number(response?.status || 0);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) throw new Error(`AudioBB request failed with HTTP ${status || "error"}.`);
    try { return JSON.parse(responseBody(response)); } catch (_) { throw new Error("AudioBB returned invalid JSON."); }
  }
  function idForPost(id) {
    const value = Number(id);
    if (!Number.isInteger(value) || value < 1 || value > 999999999) throw new Error("Invalid AudioBB post ID.");
    return `audiobb:post:${value}`;
  }
  function postNumber(value) {
    const raw = text(value);
    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      if (Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 999999999) return numeric;
    }
    const match = raw.match(/^audiobb:post:(\d+)$/i) || raw.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/i);
    if (!match || Number(match[1]) < 1) throw new Error("Invalid AudioBB title ID.");
    return Number(match[1]);
  }
  function trackID(postID, number) { return `audiobb:track:${postNumber(postID)}:${number}`; }
  function trackReference(value) {
    const match = text(value).match(/^audiobb:track:(\d+):(\d+)$/i);
    if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) throw new Error("Invalid AudioBB chapter ID.");
    return { postID: Number(match[1]), number: Number(match[2]) };
  }
  function termsFor(post) { return [...new Set((post?._embedded?.["wp:term"] || []).flat().map((term) => stripHTML(term?.name)).filter(Boolean))]; }
  function itemFor(post) {
    if (!Number.isInteger(Number(post?.id)) || Number(post.id) < 1) return null;
    const url = safeURL(post?.link, SOURCE_HOSTS);
    if (!url) return null;
    return { id: idForPost(post.id), href: url, url, title: stripHTML(post?.title?.rendered) || `AudioBB ${post.id}`, image: safeURL(post?._embedded?.["wp:featuredmedia"]?.[0]?.source_url, SOURCE_HOSTS), description: stripHTML(post?.excerpt?.rendered || ""), author: "", genres: termsFor(post) };
  }
  async function searchResults(query, page = 1) {
    const requestedPage = Math.max(1, Number(page) || 1);
    const value = typeof query === "string" ? query.trim() : "";
    const url = new URL(`${API_URL}/posts`);
    url.searchParams.set("per_page", String(PAGE_SIZE)); url.searchParams.set("page", String(requestedPage)); url.searchParams.set("_embed", "1"); url.searchParams.set("orderby", "date"); url.searchParams.set("order", "desc");
    if (value && !value.startsWith("__feed:")) url.searchParams.set("search", value.slice(0, 120));
    if (typeof globalThis.fetchv2 !== "function") throw new Error("AudioBB requires fetchv2.");
    const response = await globalThis.fetchv2(url.toString(), { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" }, "GET", null, { followRedirects: true, maxBytesHint: MAX_RESPONSE_BYTES, responseClass: "json" });
    const status = Number(response?.status || 0);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) throw new Error(`AudioBB search failed with HTTP ${status || "error"}.`);
    let payload; try { payload = JSON.parse(responseBody(response)); } catch (_) { throw new Error("AudioBB search returned invalid JSON."); }
    const totalPages = Number(header(response, "x-wp-totalpages"));
    return { items: (Array.isArray(payload) ? payload : []).map(itemFor).filter(Boolean), hasMore: Number.isFinite(totalPages) ? requestedPage < totalPages : (Array.isArray(payload) && payload.length === PAGE_SIZE) };
  }
  async function fetchPost(id) {
    const post = await requestJSON(`${API_URL}/posts/${postNumber(id)}?_embed=1`);
    if (!post?.id) throw new Error("AudioBB title was not found.");
    return post;
  }
  function audioLinks(html, postID) {
    const output = []; const seen = new Set();
    for (const match of [...String(html || "").matchAll(/<a\b([^>]*href=["'][^"']+["'][^>]*)>/gi)]) {
      const href = attribute(match[1] || "", "href");
      const url = safeURL(href, MEDIA_HOSTS);
      if (!url || seen.has(url)) continue;
      const parsed = new URL(url); const pathname = parsed.pathname.toLowerCase();
      const extension = /\.(mp3|m4a|m4b|mp4|opus)$/.exec(pathname)?.[1];
      if (!extension || (parsed.hostname.toLowerCase() === "rapidgator.net" && pathname.endsWith(".html"))) continue;
      seen.add(url); output.push({ id: trackID(postID, output.length + 1), number: output.length + 1, url, title: decodeHTML(parsed.pathname.split("/").pop() || `Track ${output.length + 1}`), format: extension === "mp4" ? "m4a" : extension });
    }
    return output;
  }
  async function extractDetails(id) {
    const post = await fetchPost(id); const tracks = audioLinks(post.content?.rendered, post.id); const item = itemFor(post); const author = post?._embedded?.author?.[0]?.name ? stripHTML(post._embedded.author[0].name) : "";
    return { ...item, authors: author ? [author] : [], author, status: "Unknown", chapterCount: tracks.length, genres: termsFor(post) };
  }
  async function extractChapters(id) {
    const post = await fetchPost(id); const tracks = audioLinks(post.content?.rendered, post.id);
    if (!tracks.length) throw new Error("AudioBB returned no direct HTTPS audio file; download pages are not playable tracks.");
    return tracks.map((track) => ({ id: track.id, href: safeURL(post.link, SOURCE_HOSTS), url: track.id, title: track.title, number: track.number, language: "en" }));
  }
  async function extractAudio(id) {
    const reference = trackReference(id); const post = await fetchPost(reference.postID); const tracks = audioLinks(post.content?.rendered, post.id); const track = tracks.find((candidate) => candidate.number === reference.number);
    if (!track) throw new Error("AudioBB chapter has no direct HTTPS audio file.");
    return { tracks: [{ id: track.id, title: track.title, url: track.url, format: track.format, fileName: `audiobb-${reference.postID}-${reference.number}.${track.format}`, part: reference.number, track: reference.number, language: "en" }] };
  }
  async function discoveryHome() { const feed = await searchResults("__feed:latest", 1); return { sections: [{ id: "latest", title: "Latest audiobooks", items: feed.items }] }; }
  async function discoveryFeed(feedID, page = 1) { if (!["latest", "popular", "catalogue"].includes(String(feedID || "latest").toLowerCase())) throw new Error("AudioBB feed is not supported."); return searchResults("__feed:latest", page); }
  const handlers = { searchResults, extractDetails, extractChapters, extractAudio, discoveryHome, discoveryFeed };
  globalThis.SynthetiqModule = handlers; Object.assign(globalThis, handlers);
})();
