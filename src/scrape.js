#!/usr/bin/env node
// Scout ⇄ Apify pipeline entrypoint.
//
// 1. Reads config.json to learn which Meta sources + targets to scrape.
// 2. Runs the matching Apify actors (one run per target so we keep an
//    accurate source label and can date-filter each).
// 3. Maps every raw item into Scout's leads.json schema.
// 4. Merges with the existing leads.json, dedupes by post_id, sorts
//    newest-first, caps the list, and writes it back.
//
// If a single run fails the others still contribute — mirroring Scout's own
// "one source down, still ship the good data" behaviour.

import { ApifyClient } from "apify-client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAPPERS } from "./mappers.js";
import { dedupeById, sortNewestFirst, isFreshEnough } from "./lead-utils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadConfig() {
  const raw = fs.readFileSync(path.join(ROOT, "config.json"), "utf8");
  return JSON.parse(raw);
}

/**
 * Convert a date filter to YYYY-MM-DD for actors that need an absolute date.
 * Accepts an ISO/YYYY-MM-DD string (passed through as the date part) or a
 * relative value like "14 days", "2 months", "1 year". Returns undefined if
 * it can't parse one.
 */
function toStartDate(value) {
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
function buildJobs(config) {
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

async function runJob(client, job, opts) {
  const mapper = MAPPERS[job.key];
  const label = job.sourceLabel ? ` [${job.sourceLabel}]` : "";
  console.log(`→ Running ${job.actor}${label} …`);
  const run = await client.actor(job.actor).call(job.input);
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const leads = [];
  for (const item of items) {
    try {
      const lead = mapper(item, job.sourceLabel, opts);
      if (lead) leads.push(lead);
    } catch (err) {
      console.warn(`  ! skipped an item: ${err.message}`);
    }
  }
  console.log(`  ✓ ${items.length} items → ${leads.length} client lead(s)`);
  return leads;
}

function loadExisting(outputFile) {
  const full = path.join(ROOT, outputFile);
  if (!fs.existsSync(full)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`! Could not parse existing ${outputFile}; starting fresh.`);
    return [];
  }
}

async function main() {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.error("APIFY_TOKEN is not set. Export it or add it as a repo secret.");
    process.exit(1);
  }

  const config = loadConfig();
  // Classifier options — undefined arrays fall back to the built-in defaults.
  const opts = {
    clientLeadsOnly: config.clientLeadsOnly !== false,
    block: config.blockKeywords,
    artRoles: config.artRoleKeywords,
    deprioritize: config.deprioritizeKeywords,
    coreArt: config.coreArtKeywords,
    strong: config.strongHireKeywords,
    include: config.includeKeywords,
    exclude: config.excludeKeywords,
    closed: config.closedKeywords,
  };
  const client = new ApifyClient({ token });

  const jobs = buildJobs(config);
  if (!jobs.length) {
    console.error("No enabled sources with targets in config.json. Nothing to do.");
    process.exit(1);
  }

  const fresh = [];
  let failures = 0;
  for (const job of jobs) {
    try {
      const leads = await runJob(client, job, opts);
      fresh.push(...leads);
    } catch (err) {
      failures += 1;
      console.error(`  ✗ ${job.actor} failed: ${err.message}`);
    }
  }

  if (failures === jobs.length) {
    console.error("Every scrape failed — leaving existing leads.json untouched.");
    process.exit(1);
  }

  const existing = config.keepExisting ? loadExisting(config.outputFile) : [];
  // New leads first so they win on dedupe (fresher content/quality).
  let merged = sortNewestFirst(dedupeById([...fresh, ...existing]));

  // Hard freshness cap: drop anything older than maxAgeDays, regardless of
  // what an actor returned or how long a lead has been carried over. This is
  // what guarantees the feed stays recent (no stale/2-month-old posts).
  const beforeAge = merged.length;
  merged = merged.filter((l) => isFreshEnough(l, config.maxAgeDays));
  const dropped = beforeAge - merged.length;

  const capped = merged.slice(0, config.maxLeads ?? 250);

  const outPath = path.join(ROOT, config.outputFile);
  fs.writeFileSync(outPath, JSON.stringify(capped, null, 2) + "\n");
  console.log(
    `\nWrote ${capped.length} leads to ${config.outputFile} ` +
      `(${fresh.length} scraped, ${existing.length} carried over, ` +
      `${dropped} older than ${config.maxAgeDays ?? "∞"}d dropped, ${failures} run(s) failed).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
