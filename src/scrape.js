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
import { MAPPERS } from "./mappers.js";
import { dedupeById, sortNewestFirst, isFreshEnough } from "./lead-utils.js";
import { ROOT, loadConfig, buildJobs } from "./jobs.js";

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
