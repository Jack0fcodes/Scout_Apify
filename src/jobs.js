// Turns config.json into the exact list of Apify actor runs the pipeline will
// perform. Shared by scrape.js (which runs them) and preview.js (which prints
// them). Keeping this here means the preview always matches what actually runs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
}

/**
 * Convert a date filter to YYYY-MM-DD for actors that need an absolute date.
 * Accepts an ISO/YYYY-MM-DD string (passed through as the date part) or a
 * relative value like "14 days", "2 months", "1 year". Returns undefined if
 * it can't parse one.
 */
export function toStartDate(value) {
  if (!value) return undefined;
  const iso = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const rel = String(value).match(/^(\d+)\s*(day|week|month|year)s?$/i);
  if (!rel) return undefined;
  const n = Number(rel[1]);
  const d = new Date();
  const unit = rel[2].toLowerCase();
  if (unit === "day") d.setDate(d.getDate() - n);
  else if (unit === "week") d.setDate(d.getDate() - n * 7);
  else if (unit === "month") d.setMonth(d.getMonth() - n);
  else if (unit === "year") d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Expand config into a flat list of jobs. Each job is:
 *   { key, actor, input, sourceLabel }
 * where `key` selects the mapper and `sourceLabel` is the human-facing
 * source string for cards produced by that run.
 */
export function buildJobs(config) {
  const jobs = [];
  const s = config.sources || {};
  const newerThan = config.onlyPostsNewerThan;

  // --- Facebook: one keyword search per term (the card source is the
  //     keyword). Searching all public posts finds actual hiring requests,
  //     unlike scraping a single fixed group. ---
  const fb = s.facebook;
  if (fb?.enabled) {
    const startDate = toStartDate(newerThan);
    for (const kw of fb.keywords || []) {
      const input = {
        query: kw,
        resultsCount: fb.resultsCount ?? 30,
        searchType: fb.searchType || "latest",
      };
      if (startDate) input.startDate = startDate;
      jobs.push({ key: "facebook", actor: fb.actor, input, sourceLabel: kw });
    }
  }

  // --- Instagram: ALL hashtags + profile URLs in ONE run. Hashtags are
  //     scraped via their /explore/tags/<tag>/ URL (the actor's `search`
  //     mode relies on Google and returns ~nothing without a login). Each
  //     result carries its `inputUrl`, so the mapper recovers the hashtag
  //     for the card source (sourceLabel left null). `resultsLimit` is per
  //     URL, so batching keeps the same depth per hashtag. ---
  const ig = s.instagram;
  if (ig?.enabled) {
    const directUrls = [
      ...(ig.hashtags || []).map(
        (tag) =>
          `https://www.instagram.com/explore/tags/${encodeURIComponent(tag.replace(/^#/, ""))}/`
      ),
      ...(ig.profileUrls || []),
    ];
    if (directUrls.length) {
      const input = { directUrls, resultsType: "posts", resultsLimit: ig.resultsLimit ?? 30 };
      if (newerThan) input.onlyPostsNewerThan = newerThan;
      jobs.push({ key: "instagram", actor: ig.actor, input, sourceLabel: null });
    }
  }

  // --- Threads: ALL keywords in ONE run (and all usernames in one run).
  //     The actor charges a per-run start fee (~$0.08 at 4 GB), so batching
  //     keywords avoids paying it once per keyword. Each result carries its
  //     own `search_keyword`, so the mapper still labels the card's source
  //     correctly (sourceLabel is left null → mapper reads item.search_keyword).
  const th = s.threads;
  if (th?.enabled) {
    if ((th.keywords || []).length) {
      const input = {
        mode: "search",
        keywords: th.keywords,
        max_posts: th.maxPosts ?? 30,
        search_filter: th.searchFilter || "recent",
      };
      if (newerThan) input.start_date = newerThan;
      jobs.push({ key: "threads", actor: th.actor, input, sourceLabel: null });
    }
    if ((th.usernames || []).length) {
      const input = { mode: "user", usernames: th.usernames, max_posts: th.maxPosts ?? 30 };
      jobs.push({ key: "threads", actor: th.actor, input, sourceLabel: null });
    }
  }

  return jobs;
}
