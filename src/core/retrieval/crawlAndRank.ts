/**
 * Company site crawler + link ranker.
 *
 * Design (per Section 2 / Section 3 of the brief):
 *  - No hardcoded path list. Companies bury hiring info at /careers, /jobs, a handbook,
 *    an engineering blog, etc — the crawler discovers and ranks, it doesn't guess paths.
 *  - Two-stage scoring:
 *      Stage 1 (cheap): score every discovered link by URL path + anchor text keywords,
 *        before fetching anything. This is what decides *fetch order* under a tight
 *        page/time budget.
 *      Stage 2 (informed): after fetching a candidate page, re-score using its actual
 *        content (keyword density for hiring/interview-process language). This catches
 *        pages whose URL gives no hint (e.g. a generic "/life" page that happens to be
 *        the hiring page) and demotes false positives caught by URL heuristics alone.
 *  - BFS with a depth + page-count budget, same-origin only, robots.txt respected,
 *    rate-limited with backoff.
 *
 * This module returns ranked *candidates*; it does not decide what's "the" hiring page.
 * The generation layer decides how many top-ranked pages to actually use as sources.
 */

import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

// ---------- Config ----------

const MAX_PAGES_TO_FETCH = 25;
const MAX_DEPTH = 2;
const REQUEST_TIMEOUT_MS = 8000;
const MIN_DELAY_BETWEEN_REQUESTS_MS = 400; // politeness delay, per-host
const MAX_CONTENT_BYTES = 2_000_000; // 2MB cap, see Security section

const HIRING_URL_KEYWORDS = [
  "career", "careers", "jobs", "job", "hiring", "join", "join-us",
  "work-with-us", "workwith", "team", "life-at", "culture", "handbook",
  "engineering-blog", "eng-blog", "interview",
];

const HIRING_ANCHOR_KEYWORDS = [
  "careers", "we're hiring", "join us", "open roles", "open positions",
  "life at", "engineering blog", "how we hire", "our process",
];

const HIRING_CONTENT_KEYWORDS = [
  "interview process", "hiring process", "how we hire", "take-home",
  "take home", "onsite", "phone screen", "technical screen",
  "system design interview", "coding challenge", "open positions",
  "we're hiring", "join our team",
];

const ABOUT_URL_KEYWORDS = ["about", "company", "who-we-are", "mission", "story"];

export interface CrawlOptions {
  companyUrl: string;
  fetchPage: (url: string) => Promise<{ status: number; html: string } | null>;
}

export interface RankedPage {
  url: string;
  urlScore: number;
  contentScore: number;
  totalScore: number;
  kind: "hiring" | "about" | "unknown";
  title: string;
  textExcerpt: string; // cleaned text, truncated — feeds generation, not the whole DOM
}

export interface CrawlResult {
  rankedPages: RankedPage[];
  unreachable: { url: string; reason: string }[];
}

interface QueueItem {
  url: string;
  depth: number;
  anchorText: string;
}

/**
 * Crawls a company site starting from its homepage, discovers and ranks links,
 * fetches the most promising ones, and returns them ranked by how likely they
 * are to contain hiring/interview-process information (or company background).
 */
export async function crawlAndRank(opts: CrawlOptions): Promise<CrawlResult> {
  const origin = new URL(opts.companyUrl).origin;
  const robotsRules = await loadRobots(origin, opts.fetchPage);

  const visited = new Set<string>();
  const unreachable: CrawlResult["unreachable"] = [];
  const candidates: { url: string; anchorText: string; depth: number }[] = [];

  const queue: QueueItem[] = [{ url: opts.companyUrl, depth: 0, anchorText: "" }];
  let fetchCount = 0;

  while (queue.length > 0 && fetchCount < MAX_PAGES_TO_FETCH) {
    const item = queue.shift()!;
    const normalized = normalizeUrl(item.url, origin);
    if (!normalized || visited.has(normalized)) continue;
    visited.add(normalized);

    if (!isAllowedByRobots(robotsRules, normalized)) continue;

    await politeDelay();
    const page = await safeFetch(opts.fetchPage, normalized);
    fetchCount++;

    if (!page) {
      unreachable.push({ url: normalized, reason: "fetch failed or timed out" });
      continue;
    }
    if (page.status >= 400) {
      unreachable.push({ url: normalized, reason: `HTTP ${page.status}` });
      continue;
    }

    candidates.push({ url: normalized, anchorText: item.anchorText, depth: item.depth });

    if (item.depth < MAX_DEPTH) {
      const links = extractLinks(page.html, normalized, origin);
      // Stage 1: cheap URL/anchor scoring decides queue order (best-first, not pure BFS)
      const scored = links
        .filter((l) => !visited.has(l.url))
        .map((l) => ({ ...l, depth: item.depth + 1, score: scoreUrlAndAnchor(l.url, l.anchorText) }))
        .sort((a, b) => b.score - a.score);
      for (const l of scored) {
        queue.push({ url: l.url, depth: l.depth, anchorText: l.anchorText });
      }
    }

    // Store the page content alongside the candidate for stage-2 scoring below
    (candidates[candidates.length - 1] as any).html = page.html;
  }

  // Stage 2: content-informed re-scoring of every page we actually fetched
  const rankedPages: RankedPage[] = candidates.map((c: any) => {
    const $ = cheerio.load(c.html);
    const title = $("title").first().text().trim();
    const text = extractCleanText($);
    const urlScore = scoreUrlAndAnchor(c.url, c.anchorText);
    const contentScore = scoreContent(text);
    const totalScore = urlScore + contentScore;
    const kind = classify(c.url, text);

    return {
      url: c.url,
      urlScore,
      contentScore,
      totalScore,
      kind,
      title,
      textExcerpt: text.slice(0, 4000),
    };
  });

  rankedPages.sort((a, b) => b.totalScore - a.totalScore);

  return { rankedPages, unreachable };
}

// ---------- Scoring ----------

function scoreUrlAndAnchor(url: string, anchorText: string): number {
  const path = new URL(url).pathname.toLowerCase();
  const anchor = (anchorText || "").toLowerCase();
  let score = 0;

  for (const kw of HIRING_URL_KEYWORDS) {
    if (path.includes(kw)) score += 3;
  }
  for (const kw of HIRING_ANCHOR_KEYWORDS) {
    if (anchor.includes(kw)) score += 2;
  }
  for (const kw of ABOUT_URL_KEYWORDS) {
    if (path.includes(kw)) score += 1;
  }
  // Shallower paths are slightly favored — /careers beats /blog/2019/some-post/careers-mentioned
  const depthPenalty = Math.max(0, path.split("/").filter(Boolean).length - 1);
  score -= depthPenalty * 0.5;

  return score;
}

function scoreContent(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of HIRING_CONTENT_KEYWORDS) {
    if (lower.includes(kw)) score += 4;
  }
  return score;
}

function classify(url: string, text: string): RankedPage["kind"] {
  const path = new URL(url).pathname.toLowerCase();
  const lower = text.toLowerCase();
  const hiringHit =
    HIRING_URL_KEYWORDS.some((k) => path.includes(k)) ||
    HIRING_CONTENT_KEYWORDS.some((k) => lower.includes(k));
  if (hiringHit) return "hiring";
  if (ABOUT_URL_KEYWORDS.some((k) => path.includes(k))) return "about";
  return "unknown";
}

// ---------- Helpers ----------

function extractLinks(html: string, pageUrl: string, origin: string) {
  const $ = cheerio.load(html);
  const links: { url: string; anchorText: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const resolved = normalizeUrl(href, origin, pageUrl);
    if (!resolved) return;
    // same-origin only — Section 2's "crawl the company site", not the open web
    if (new URL(resolved).origin !== origin) return;
    links.push({ url: resolved, anchorText: $(el).text().trim() });
  });
  return links;
}

function extractCleanText($: cheerio.CheerioAPI): string {
  $("script, style, nav, footer, noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function normalizeUrl(href: string, origin: string, base?: string): string | null {
  try {
    const resolved = new URL(href, base ?? origin);
    resolved.hash = "";
    // reject non-http(s), mailto:, tel:, javascript: etc.
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

async function loadRobots(
  origin: string,
  fetchPage: CrawlOptions["fetchPage"]
) {
  try {
    const res = await fetchPage(`${origin}/robots.txt`);
    if (!res || res.status >= 400) return null;
    return robotsParser(`${origin}/robots.txt`, res.html);
  } catch {
    return null; // absent/unreachable robots.txt — treat as no restrictions
  }
}

function isAllowedByRobots(rules: ReturnType<typeof robotsParser> | null, url: string): boolean {
  if (!rules) return true;
  return rules.isAllowed(url, "AIInterviewPrepKitBot") ?? true;
}

let lastRequestAt = 0;
async function politeDelay() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + MIN_DELAY_BETWEEN_REQUESTS_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function safeFetch(
  fetchPage: CrawlOptions["fetchPage"],
  url: string,
  retries = 2
): Promise<{ status: number; html: string } | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await withTimeout(fetchPage(url), REQUEST_TIMEOUT_MS);
      if (result && result.html.length > MAX_CONTENT_BYTES) {
        result.html = result.html.slice(0, MAX_CONTENT_BYTES);
      }
      return result;
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); // backoff
      }
    }
  }
  return null; // skip and report, per Section 2 — don't fail the whole run
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}
