"use strict";

(() => {
  const BASE_URL = "https://ezaudiobookforsoul.com";
  const API_URL = `${BASE_URL}/wp-json/wp/v2`;
  const PAGE_SIZE = 20;
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  const SOURCE_HOSTS = new Set(["ezaudiobookforsoul.com"]);
  const MEDIA_HOSTS = new Set(["ezaudiocdn.b-cdn.net"]);

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
  function responseBody(response) { if (response?.bodyDropped) throw new Error("Audiobooks For Your Soul response exceeded the module limit."); return typeof response?.body === "string" ? response.body : ""; }
  function header(response, name) {
    if (typeof response?.headers?.get === "function") return response.headers.get(name);
    const key = Object.keys(response?.headers || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key ? response.headers[key] : "";
  }
  async function requestJSON(url) {
    if (typeof globalThis.fetchv2 !== "function") throw new Error("Audiobooks For Your Soul requires fetchv2.");
    const response = await globalThis.fetchv2(url, { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" }, "GET", null, { followRedirects: true, maxBytesHint: MAX_RESPONSE_BYTES, responseClass: "json" });
    const status = Number(response?.status || 0);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) throw new Error(`Audiobooks For Your Soul request failed with HTTP ${status || "error"}.`);
    try { return JSON.parse(responseBody(response)); } catch (_) { throw new Error("Audiobooks For Your Soul returned invalid JSON."); }
  }
  async function requestHTML(url) {
    if (typeof globalThis.fetchv2 !== "function") throw new Error("Audiobooks For Your Soul requires fetchv2.");
    const response = await globalThis.fetchv2(url, { Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" }, "GET", null, { followRedirects: true, maxBytesHint: MAX_RESPONSE_BYTES, responseClass: "html" });
    const status = Number(response?.status || 0);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) throw new Error(`Audiobooks For Your Soul page failed with HTTP ${status || "error"}.`);
    return responseBody(response);
  }
  function idForProduct(id) {
    const value = Number(id);
    if (!Number.isInteger(value) || value < 1 || value > 999999999) throw new Error("Invalid Audiobooks For Your Soul product ID.");
    return `audiobooks-for-your-soul:product:${value}`;
  }
  function productNumber(value) {
    const raw = text(value);
    if (/^\d+$/.test(raw)) {
      const numeric = Number(raw);
      if (Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 999999999) return numeric;
    }
    const match = raw.match(/^audiobooks-for-your-soul:product:(\d+)$/i) || raw.match(/\/wp-json\/wp\/v2\/product\/(\d+)/i);
    if (!match || Number(match[1]) < 1) throw new Error("Invalid Audiobooks For Your Soul title ID.");
    return Number(match[1]);
  }
  function chapterID(productID, number) { return `audiobooks-for-your-soul:chapter:${productNumber(productID)}:${number}`; }
  function chapterReference(value) {
    const match = text(value).match(/^audiobooks-for-your-soul:chapter:(\d+):(\d+)$/i);
    if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) throw new Error("Invalid Audiobooks For Your Soul chapter ID.");
    return { productID: Number(match[1]), number: Number(match[2]) };
  }
  function termsFor(product) { return [...new Set((product?._embedded?.["wp:term"] || []).flat().map((term) => stripHTML(term?.name)).filter(Boolean))]; }
  function itemFor(product) {
    if (!Number.isInteger(Number(product?.id)) || Number(product.id) < 1) return null;
    const url = safeURL(product?.link, SOURCE_HOSTS);
    if (!url) return null;
    return { id: idForProduct(product.id), href: url, url, title: stripHTML(product?.title?.rendered) || `Audiobook ${product.id}`, image: safeURL(product?._embedded?.["wp:featuredmedia"]?.[0]?.source_url, MEDIA_HOSTS), description: stripHTML(product?.excerpt?.rendered || ""), author: "", genres: termsFor(product) };
  }
  async function searchResults(query, page = 1) {
    const requestedPage = Math.max(1, Number(page) || 1);
    const value = typeof query === "string" ? query.trim() : "";
    const url = new URL(`${API_URL}/product`);
    url.searchParams.set("per_page", String(PAGE_SIZE)); url.searchParams.set("page", String(requestedPage)); url.searchParams.set("_embed", "1"); url.searchParams.set("orderby", "date"); url.searchParams.set("order", "desc");
    if (value && !value.startsWith("__feed:")) url.searchParams.set("search", value.slice(0, 120));
    if (typeof globalThis.fetchv2 !== "function") throw new Error("Audiobooks For Your Soul requires fetchv2.");
    const response = await globalThis.fetchv2(url.toString(), { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" }, "GET", null, { followRedirects: true, maxBytesHint: MAX_RESPONSE_BYTES, responseClass: "json" });
    const status = Number(response?.status || 0);
    if (!response || response.ok === false || (status && (status < 200 || status >= 300))) throw new Error(`Audiobooks For Your Soul search failed with HTTP ${status || "error"}.`);
    let payload; try { payload = JSON.parse(responseBody(response)); } catch (_) { throw new Error("Audiobooks For Your Soul search returned invalid JSON."); }
    const totalPages = Number(header(response, "x-wp-totalpages"));
    return { items: (Array.isArray(payload) ? payload : []).map(itemFor).filter(Boolean), hasMore: Number.isFinite(totalPages) ? requestedPage < totalPages : (Array.isArray(payload) && payload.length === PAGE_SIZE) };
  }
  async function fetchProduct(id) {
    const product = await requestJSON(`${API_URL}/product/${productNumber(id)}?_embed=1`);
    if (!product?.id) throw new Error("Audiobooks For Your Soul title was not found.");
    return product;
  }
  function tracksFromHTML(html, productID) {
    const output = []; const blocks = [...String(html || "").matchAll(/<span\b[^>]*class=["'][^"']*simp-source[^"']*["'][^>]*>[\s\S]*?(?=<span\b[^>]*class=["'][^"']*simp-source|<\/ul>)/gi)];
    const seen = new Set();
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index][0];
      const encoded = attribute(block, "data-src");
      if (!encoded || seen.has(encoded)) continue;
      seen.add(encoded);
      const blockText = stripHTML(block);
      const chapterMatch = blockText.match(/(?:^|\s)((?:Prologue|Chapter|Part)\s+[^\n]+?)(?:-\d{5,})?$/i);
      const title = chapterMatch ? chapterMatch[1].trim() : `Track ${index + 1}`;
      output.push({ id: chapterID(productID, index + 1), number: index + 1, title, encoded, index });
    }
    return output;
  }
  async function sourcePageFor(product) {
    const url = safeURL(product?.link, SOURCE_HOSTS);
    if (!url) throw new Error("Audiobooks For Your Soul returned an invalid title URL.");
    return { url, html: await requestHTML(url) };
  }
  async function extractDetails(id) {
    const product = await fetchProduct(id); const item = itemFor(product); const page = await sourcePageFor(product); const tracks = tracksFromHTML(`${product.content?.rendered || ""}\n${page.html}`, product.id);
    const authorLinks = [...page.html.matchAll(/<a\b[^>]*href=["'][^"']*\/authors?\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => stripHTML(match[1])).filter(Boolean);
    const authors = [...new Set(authorLinks)];
    const image = item.image || safeURL((/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i.exec(page.html) || [])[1], MEDIA_HOSTS);
    return { ...item, image, authors, author: authors.join(", "), status: "Unknown", chapterCount: tracks.length, genres: termsFor(product) };
  }
  async function extractChapters(id) {
    const product = await fetchProduct(id); const page = await sourcePageFor(product); const tracks = tracksFromHTML(`${product.content?.rendered || ""}\n${page.html}`, product.id);
    if (!tracks.length) throw new Error("Audiobooks For Your Soul returned no public playlist entries.");
    return tracks.map((track) => ({ id: track.id, href: safeURL(product.link, SOURCE_HOSTS), url: track.id, title: track.title, number: track.number, language: "en" }));
  }
  async function extractAudio(id) {
    const reference = chapterReference(id); const product = await fetchProduct(reference.productID); const pageURL = safeURL(product.link, SOURCE_HOSTS); if (!pageURL) throw new Error("Audiobooks For Your Soul returned an invalid reader URL.");
    if (typeof globalThis.pagev2 !== "function") throw new Error("Audiobooks For Your Soul requires the pagev2 bridge for its public player.");
    const result = await globalThis.pagev2({
      url: pageURL,
      headers: { Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
      timeoutMilliseconds: 25000,
      settleMilliseconds: 900,
      waitForSelector: "audio source[src]",
      maxEntries: 8,
      maxResponseCharacters: 100000,
      actionScript: `(() => { const entries = document.querySelectorAll('.simp-source'); const entry = entries[${reference.number - 1}]; if (!entry) throw new Error('Audio playlist entry was not found.'); entry.click(); })()`,
      returnScript: "(() => { const source = document.querySelector('audio source[src]'); return JSON.stringify({ url: source && source.src ? source.src : '' }); })()",
    });
    let payload; try { payload = JSON.parse(typeof result?.evaluatedData === "string" ? result.evaluatedData : "{}"); } catch (_) { throw new Error("Audiobooks For Your Soul returned invalid player data."); }
    const url = safeURL(payload.url, MEDIA_HOSTS);
    if (!url) throw new Error("Audiobooks For Your Soul player did not expose an allowed HTTPS audio resource.");
    return { tracks: [{ id, title: `Track ${reference.number}`, url, format: "mp3", fileName: `audiobooks-for-your-soul-${reference.productID}-${reference.number}.mp3`, part: reference.number, track: reference.number, language: "en" }] };
  }
  async function discoveryHome() { const feed = await searchResults("__feed:latest", 1); return { sections: [{ id: "latest", title: "Latest audiobooks", items: feed.items }] }; }
  async function discoveryFeed(feedID, page = 1) { if (!["latest", "popular", "catalogue"].includes(String(feedID || "latest").toLowerCase())) throw new Error("Audiobooks For Your Soul feed is not supported."); return searchResults("__feed:latest", page); }
  const handlers = { searchResults, extractDetails, extractChapters, extractAudio, discoveryHome, discoveryFeed };
  globalThis.SynthetiqModule = handlers; Object.assign(globalThis, handlers);
})();
