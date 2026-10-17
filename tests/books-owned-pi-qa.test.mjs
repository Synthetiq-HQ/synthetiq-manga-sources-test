import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const origin = "https://books-content-staging.synthetiq.uk";
const script = await readFile(new URL("../modules/books-owned-pi-qa/index.js", import.meta.url), "utf8");
const editions = [
  { editionID: "en", language: "en", languageName: "English" },
  { editionID: "ar", language: "ar", languageName: "Arabic" },
];
const response = (body, status = 200, headers = {}) => ({ status, ok: status < 300, headers, body: JSON.stringify(body) });
function runtime(handler) {
  const calls = [];
  const delays = [];
  const context = vm.createContext({ setTimeout: (resolve, delay) => { delays.push(delay); resolve(); }, fetchv2: async (url, headers, method, body, options) => {
    assert.equal(new URL(url).origin, origin);
    assert.equal(headers.Authorization, undefined);
    assert.equal(method, "GET");
    assert.equal(body, null);
    assert.equal(options.followRedirects, false);
    calls.push(url);
    return handler(new URL(url));
  } });
  vm.runInContext(script, context);
  return { context, calls, delays };
}
function fixture(url, count = 3001) {
  if (url.pathname.endsWith("/search")) {
    const cursor = url.searchParams.get("cursor");
    return response({ revision: "search-r1", items: [{ id: cursor ? "two" : "one", title: "Fixture" }],
      complete: Boolean(cursor), nextCursor: cursor ? null : "cursor-two" });
  }
  if (url.pathname.endsWith("/works/w")) return response({ id: "w", workID: "w", defaultEditionID: "en", availableEditions: editions });
  if (url.pathname.endsWith("/chapters")) {
    const ar = url.pathname.includes("/editions/ar/");
    const total = ar ? 1 : count;
    const offset = Number(url.searchParams.get("cursor") || 0);
    const end = Math.min(offset + 1000, total);
    return response({ revision: "chapters-r1", items: Array.from({ length: end - offset }, (_, i) => ({
      id: `${ar ? "ar" : "en"}-${offset + i}`, editionID: ar ? "ar" : "en", language: ar ? "ar" : "en",
      title: `Chapter ${offset + i}`, number: offset + i,
    })), complete: end === total, nextCursor: end === total ? null : String(end) });
  }
  return response({ pages: [{ assetID: "p", assetRevision: "r", pageIndex: 0, sha256: "0".repeat(64), byteCount: 123,
    url: `${origin}/books/v1/assets/p/r` }] });
}
test("Catalogue and details preserve reviewed cover URLs without provider requests", async () => {
  const image = `${origin}/books/v1/assets/cover-reviewed/${"a".repeat(64)}`;
  const item = { id: "w", title: "Fixture", image };
  const { context, calls } = runtime(url => url.pathname.endsWith("/search")
    ? response({ revision: "r1", items: [item], complete: true, nextCursor: null })
    : response(item));
  assert.equal((await context.searchResults("Fixture", 1)).items[0].image, image);
  assert.equal((await context.extractDetails("w")).image, image);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => new URL(url).origin === origin));
});
test("Absent cover metadata remains an empty image, not a fabricated page", async () => {
  const { context } = runtime(() => response({ id: "w", title: "Fixture", image: "" }));
  assert.equal((await context.extractDetails("w")).image, "");
});
test("Complete chapter pagination and concurrent editions retain explicit ownership", async () => {
  const { context } = runtime(fixture);
  const [en, ar] = await Promise.all([context.extractChapters("w"), context.extractChapters("w", editions[1])]);
  assert.equal(en.length, 3001); assert.equal(ar.length, 1);
  assert.ok(en.every(c => c.language === "en")); assert.ok(ar.every(c => c.language === "ar"));
  await assert.rejects(context.extractChapters("w", { editionID: "ar", language: "en" }), /edition_unavailable/);
  assert.equal((await context.extractImages("ar-0"))[0].headers.Authorization, undefined);
});
test("Search pagination is stateless and reaches the terminal page", async () => {
  const { context } = runtime(fixture);
  assert.equal((await context.searchResults("A & B", 1)).items[0].id, "one");
  assert.equal((await context.searchResults("A & B", 2)).items[0].id, "two");
  assert.equal((await context.searchResults("A & B", 3)).items.length, 0);
  assert.equal((await context.discoveryHome()).sections[0].items.length, 1);
});
test("Full archive catalogue pagination retains all 385 works without duplicates", async () => {
  const { context } = runtime(url => {
    const offset = Number(url.searchParams.get("cursor") || 0);
    const end = Math.min(offset + 100, 385);
    return response({ revision: "full-index-r1", items: Array.from({ length: end - offset }, (_, i) => ({
      id: `fixture-${offset + i}`, title: `Fixture ${offset + i}`,
    })), complete: end === 385, nextCursor: end === 385 ? null : String(end) });
  });
  const ids = [];
  for (let page = 1; page <= 4; page++) {
    const result = await context.discoveryFeed("popular", page);
    assert.equal(result.hasMore, page < 4);
    ids.push(...result.items.map(item => item.id));
  }
  assert.equal(ids.length, 385);
  assert.equal(new Set(ids).size, 385);
  assert.equal((await context.searchResults("", 5)).items.length, 0);
});
test("Wide edition metadata preserves 107 explicit choices and requests the selected edition", async () => {
  const wide = Array.from({ length: 107 }, (_, i) => ({
    editionID: `edition-${i}`, language: "en", languageName: "English",
    translationGroup: { id: `group-${i}`, name: `Group ${i}` },
  }));
  const { context } = runtime(url => url.pathname.endsWith("/chapters")
    ? response({ revision: "r1", items: [{ id: "c", editionID: wide[106].editionID, language: "en" }],
      complete: true, nextCursor: null })
    : response({ id: "w", workID: "w", defaultEditionID: wide[0].editionID, availableEditions: wide }));
  assert.equal((await context.extractDetails("w")).availableEditions.length, 107);
  assert.equal((await context.extractChapters("w", wide[106]))[0].editionID, wide[106].editionID);
});
test("Native Discover feed aliases paginate the archive catalogue", async () => {
  const { context } = runtime(fixture);
  for (const feed of ["archive", "popular", "latest"]) {
    assert.equal((await context.discoveryFeed(feed, 1)).items[0].id, "one");
    assert.equal((await context.discoveryFeed(feed, 2)).items[0].id, "two");
    assert.equal((await context.discoveryFeed(feed, 3)).items.length, 0);
  }
  await assert.rejects(context.discoveryFeed("unknown", 1), /feed_unavailable/);
});
test("Empty translations never fall back", async () => {
  const { context } = runtime(url => url.pathname.endsWith("/chapters")
    ? response({ revision: "r1", items: [], complete: true, nextCursor: null }) : fixture(url));
  assert.equal((await context.extractChapters("w", editions[1])).length, 0);
});
test("Wrong-language and duplicate rows fail rather than silently merge", async () => {
  for (const bad of ["mixed", "duplicate"]) {
    const { context } = runtime(url => {
      if (!url.pathname.endsWith("/chapters")) return fixture(url);
      const row = { id: "c", editionID: bad === "mixed" ? "ar" : "en", language: "en" };
      return response({ revision: "r1", items: bad === "mixed" ? [row] : [row, row], complete: true, nextCursor: null });
    });
    await assert.rejects(context.extractChapters("w"), /invalid_chapter_ownership/);
  }
});
test("Denied access has no source fallback or module credentials", async () => {
  const { context, calls } = runtime(() => response({ error: { code: "grant_expired", retryable: false } }, 401));
  await assert.rejects(context.extractDetails("w"), /grant_expired/); assert.equal(calls.length, 1);
});
test("Retries respect the whole-operation budget", async () => {
  const { context, calls } = runtime(() => response({ error: { code: "busy", retryable: true } }, 503, { "Retry-After": "0" }));
  await assert.rejects(context.extractDetails("w"), /busy/); assert.equal(calls.length, 3);
});
test("Temporary HTML gateway errors retry without requiring a JSON error body", async () => {
  for (const status of [429, 500, 502, 503, 504]) {
    let attempts = 0;
    const { context, calls } = runtime(() => ++attempts === 1
      ? { status, ok: false, headers: { "Retry-After": "0" }, body: "<html>Temporarily unavailable</html>" }
      : response({ id: "w", title: "Fixture" }));
    assert.equal((await context.extractDetails("w")).id, "w");
    assert.equal(calls.length, 2);
  }
});
test("Retry-After HTTP dates are respected within the original request budget", async () => {
  const retryDate = new Date(Date.now() + 5000).toUTCString();
  let attempts = 0;
  const { context, delays } = runtime(() => ++attempts === 1
    ? response({ error: { code: "busy", retryable: true } }, 503, { "Retry-After": retryDate })
    : response({ id: "w" }));
  await context.extractDetails("w");
  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 3000 && delays[0] <= 5000);
});
test("Long Retry-After values never extend the deadline or immediately retry", async () => {
  for (const value of ["120", new Date(Date.now() + 120000).toUTCString()]) {
    const { context, calls, delays } = runtime(() => response(
      { error: { code: "busy", retryable: true } }, 503, { "Retry-After": value }));
    await assert.rejects(context.extractDetails("w"), /busy/);
    assert.equal(calls.length, 1);
    assert.equal(delays.length, 0);
  }
});
test("Malformed success and HTML access denials are not retried", async () => {
  for (const status of [200, 401, 403, 404]) {
    const { context, calls } = runtime(() => ({ status, ok: status === 200, headers: {}, body: "<html>Unavailable</html>" }));
    await assert.rejects(context.extractDetails("w"));
    assert.equal(calls.length, 1);
  }
});
test("Hostile or unordered image descriptors are rejected", async () => {
  for (const bad of ["host", "order"]) {
    const { context } = runtime(() => response({ pages: [{ assetID: "p", assetRevision: "r", pageIndex: bad === "order" ? 2 : 0,
      sha256: "0".repeat(64), byteCount: 123, url: `${origin}${bad === "host" ? ".evil.test" : ""}/books/v1/assets/p/r` }] }));
    await assert.rejects(context.extractImages("c"), /invalid_asset_descriptor/);
  }
});
test("Revision changes discard the old snapshot and restart once", async () => {
  let pages = 0;
  const { context } = runtime(url => url.pathname.endsWith("/chapters") && ++pages === 2
    ? response({ error: { code: "revision_changed", retryable: false } }, 409) : fixture(url));
  assert.equal((await context.extractChapters("w")).length, 3001); assert.equal(pages, 6);
});
test("Cursor loops and oversized chapter lists fail explicitly", async () => {
  const { context } = runtime(url => url.pathname.endsWith("/chapters")
    ? response({ revision: "r1", items: [], complete: false, nextCursor: "same" }) : fixture(url));
  await assert.rejects(context.extractChapters("w"), /invalid_chapter_pagination/);
  const large = runtime(url => fixture(url, 10001));
  await assert.rejects(large.context.extractChapters("w"), /chapter_list_too_large/);
});
