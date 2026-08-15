#!/usr/bin/env node
// Print exactly what the pipeline will send to each Apify actor — date limit,
// keywords, hashtags, the URLs it builds, result limits — WITHOUT running
// anything or spending any Apify credits. Usage: npm run preview

import { loadConfig, buildJobs } from "./jobs.js";

const config = loadConfig();
const jobs = buildJobs(config);

const line = "─".repeat(64);
console.log(line);
console.log("SCOUT_APIFY — what each run will fetch");
console.log(line);
console.log(`Scrape window (onlyPostsNewerThan) : ${config.onlyPostsNewerThan ?? "(none)"}`);
console.log(`Feed shelf-life (maxAgeDays)       : ${config.maxAgeDays ?? "(none)"} days`);
console.log(`Max leads in feed (maxLeads)       : ${config.maxLeads ?? 250}`);
console.log(`Client leads only                  : ${config.clientLeadsOnly !== false}`);
console.log(`Total actor runs per cycle         : ${jobs.length}`);
console.log(line);

const platform = { facebook: "FACEBOOK", instagram: "INSTAGRAM", threads: "THREADS" };
let n = 0;
for (const job of jobs) {
  n += 1;
  console.log(`\n[${n}] ${platform[job.key] || job.key}  ·  actor: ${job.actor}`);
  if (job.sourceLabel) console.log(`    card source : ${job.sourceLabel}`);
  console.log("    input sent to Apify:");
  for (const line of JSON.stringify(job.input, null, 2).split("\n")) {
    console.log("      " + line);
  }
}

// Config-level summary of the targets, so you can eyeball keywords/hashtags.
const s = config.sources || {};
console.log("\n" + line);
console.log("TARGETS (edit these in config.json)");
console.log(line);
for (const [name, src] of Object.entries(s)) {
  if (!src) continue;
  const on = src.enabled ? "ON " : "OFF";
  const terms = src.keywords || src.hashtags || [];
  console.log(`\n${platform[name] || name}  [${on}]  actor: ${src.actor}`);
  if (src.keywords) console.log(`  keywords (${src.keywords.length}): ${src.keywords.join(", ")}`);
  if (src.hashtags) console.log(`  hashtags (${src.hashtags.length}): ${src.hashtags.join(", ")}`);
  if (src.profileUrls?.length) console.log(`  profiles (${src.profileUrls.length}): ${src.profileUrls.join(", ")}`);
  if (src.usernames?.length) console.log(`  usernames (${src.usernames.length}): ${src.usernames.join(", ")}`);
  const depth = src.resultsCount ?? src.resultsLimit ?? src.maxPosts;
  if (depth != null) console.log(`  results per ${src.keywords ? "keyword" : "hashtag"}: ${depth}`);
}
console.log("\n" + line);
console.log("Nothing was run — this is a dry preview. Edit config.json to change any of it.");
console.log(line);
