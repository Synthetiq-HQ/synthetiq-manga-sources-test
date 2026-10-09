"use strict";
(() => {
  // Native transport supplies authorization. No credentials live in this file.
  const ORIGIN = "https://books-content-staging.synthetiq.uk";
  const BASE = "/books/v1/content";
  function budget() { return { deadline: Date.now() + 28000, attempts: 0, retries: 0 }; }
  async function get(path, operation = budget()) {
    for (let retry = 0; ; retry++) {
      if (Date.now() >= operation.deadline || ++operation.attempts > 20) throw Error("request_budget_exhausted");
      const response = await globalThis.fetchv2(ORIGIN + path, { Accept: "application/json" }, "GET", null,
        { followRedirects: false, maxBytesHint: 2097152, responseClass: "json" });
      if (Date.now() >= operation.deadline) throw Error("request_budget_exhausted");
      if (!response || response.bodyDropped) throw Error("response_unavailable");
      const raw = typeof response.body === "string" ? response.body : await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { throw Error("invalid_response"); }
      if (response.status >= 200 && response.status < 300 && response.ok !== false) return data;
      const error = Error(data.error?.code || "request_failed");
      error.code = data.error?.code || "request_failed";
      const header = Object.entries(response.headers || {}).find(([k]) => k.toLowerCase() === "retry-after")?.[1];
      const delay = /^\d+$/.test(String(header)) ? Number(header) * 1000 : 500 * (retry + 1);
      if (operation.retries >= 2 || ![429, 500, 502, 503, 504].includes(response.status) || data.error?.retryable === false ||
          typeof globalThis.setTimeout !== "function" || Date.now() + delay >= operation.deadline) throw error;
      operation.retries++;
      await new Promise(resolve => globalThis.setTimeout(resolve, delay));
    }
  }
  const encoded = value => encodeURIComponent(String(value));
  async function searchResults(query, page = 1) {
    // Native search contract uses page numbers. Traverse signed cursors without
    // sharing mutable cursor state between concurrent searches.
    if (!Number.isInteger(page) || page < 1 || page > 20) throw Error("invalid_page");
    const operation = budget();
    let cursor = null, data, revision = null;
    const seen = new Set();
    for (let index = 1; index <= page; index++) {
      data = await get(BASE + "/search?q=" + encoded(query || "") + "&limit=100" + (cursor ? "&cursor=" + encoded(cursor) : ""), operation);
      if (!Array.isArray(data.items) || typeof data.revision !== "string" || (revision && revision !== data.revision)) throw Error("invalid_search_snapshot");
      revision = data.revision;
      if (data.complete === true && data.nextCursor === null) return { items: index === page ? data.items : [], page, hasMore: false };
      if (data.complete !== false || typeof data.nextCursor !== "string" || !data.nextCursor || seen.has(data.nextCursor)) throw Error("invalid_search_pagination");
      seen.add(data.nextCursor); cursor = data.nextCursor;
    }
    return { items: data.items, page, hasMore: true };
  }
  async function extractDetails(workID) { return get(BASE + "/works/" + encoded(workID)); }
  async function extractChapters(workID, options) {
    const operation = budget();
    const details = await get(BASE + "/works/" + encoded(workID), operation);
    const edition = (details.availableEditions || []).find(e => e.editionID === (options ? options.editionID : details.defaultEditionID));
    if (!edition || (options && options.language !== edition.language)) throw Error("edition_unavailable");
    for (let restart = 0; restart <= 1; restart++) {
    const rows = [], ids = new Set(), cursors = new Set();
    let cursor = null, revision = null;
    try { while (true) {
      const data = await get(BASE + "/works/" + encoded(details.workID) + "/editions/" + encoded(edition.editionID) + "/chapters?limit=1000&language=" + encoded(edition.language) + (cursor ? "&cursor=" + encoded(cursor) : ""), operation);
      if (!Array.isArray(data.items) || typeof data.revision !== "string") throw Error("invalid_chapter_response");
      if (revision && revision !== data.revision) { const error = Error("revision_changed"); error.code = "revision_changed"; throw error; }
      revision = data.revision;
      for (const row of data.items) {
        if (!row.id || ids.has(row.id) || row.editionID !== edition.editionID || row.language !== edition.language) throw Error("invalid_chapter_ownership");
        ids.add(row.id); rows.push(row);
      }
      if (rows.length > 10000) throw Error("chapter_list_too_large");
      if (data.complete === true && data.nextCursor === null) return rows;
      if (data.complete !== false || typeof data.nextCursor !== "string" || !data.nextCursor || cursors.has(data.nextCursor)) throw Error("invalid_chapter_pagination");
      cursor = data.nextCursor; cursors.add(cursor);
    } } catch (error) { if (error.code !== "revision_changed" || restart === 1) throw error; }
    }
  }
  async function extractImages(chapterID) {
    const data = await get(BASE + "/chapters/" + encoded(chapterID) + "/assets");
    if (!Array.isArray(data.pages) || !data.pages.length) throw Error("chapter_media_unavailable");
    return data.pages.map((p, index) => {
      if (typeof p.url !== "string" || p.url !== ORIGIN + "/books/v1/assets/" + encoded(p.assetID) + "/" + encoded(p.assetRevision) || p.pageIndex !== index ||
          !/^[a-f0-9]{64}$/.test(p.sha256) || !Number.isSafeInteger(p.byteCount) || p.byteCount < 1) throw Error("invalid_asset_descriptor");
      return { ...p, headers: {} };
    });
  }
  async function discoveryHome() {
    const data = await searchResults("", 1);
    return { sections: [{ id: "archive", title: "Archive", style: "poster", items: data.items }] };
  }
  async function discoveryFeed(feedID, page = 1) {
    if (feedID !== "archive") throw Error("feed_unavailable");
    return searchResults("", page);
  }
  const handlers = { searchResults, extractDetails, extractChapters, extractImages, discoveryHome, discoveryFeed };
  globalThis.SynthetiqModule = handlers;
  Object.assign(globalThis, handlers);
})();
