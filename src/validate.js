#!/usr/bin/env node
// Validate leads.json against Scout's contract. Exits non-zero on any error,
// so it can gate CI. Usage: node src/validate.js [path]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || "leads.json";
const full = path.isAbsolute(file) ? file : path.join(ROOT, file);

const REQUIRED = [
  "post_id",
  "platform",
  "source",
  "author",
  "title",
  "content",
  "url",
  "quality",
  "budget",
  "created_at",
];
const QUALITIES = new Set(["High Quality", "Medium", "Low"]);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

let data;
try {
  data = JSON.parse(fs.readFileSync(full, "utf8"));
} catch (err) {
  console.error(`✗ Cannot read/parse ${file}: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(data)) {
  console.error("✗ Top level must be a JSON array of lead objects.");
  process.exit(1);
}

const ids = new Set();
data.forEach((lead, i) => {
  const at = `leads[${i}]`;
  for (const key of REQUIRED) {
    if (typeof lead[key] !== "string") {
      fail(`${at}: "${key}" must be a string (got ${typeof lead[key]}).`);
    }
  }
  if (lead.post_id) {
    if (ids.has(lead.post_id)) fail(`${at}: duplicate post_id "${lead.post_id}".`);
    ids.add(lead.post_id);
  }
  if (lead.quality && !QUALITIES.has(lead.quality)) {
    fail(`${at}: quality "${lead.quality}" must be exactly "High Quality", "Medium", or "Low".`);
  }
  if (lead.created_at && Number.isNaN(new Date(lead.created_at).getTime())) {
    fail(`${at}: created_at "${lead.created_at}" is not a valid date.`);
  }
});

if (process.exitCode) {
  console.error(`\nValidation failed for ${file}.`);
} else {
  console.log(`✓ ${file} is valid — ${data.length} leads, all fields present.`);
}
