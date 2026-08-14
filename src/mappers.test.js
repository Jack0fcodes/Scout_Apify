#!/usr/bin/env node
// Offline sanity tests for the mappers — no Apify token or network needed.
// Uses representative sample items shaped like each actor's real output.
// Run: npm test

import assert from "node:assert/strict";
import { mapFacebookPost, mapInstagramPost, mapThreadsPost } from "./mappers.js";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

// --- Facebook Groups ---
check("facebook: maps a hiring post with budget → High Quality", () => {
  const item = {
    legacyId: "1122334455",
    groupTitle: "Freelance Illustrators Hub",
    user: { name: "Maria Lopez" },
    title: "Looking for a comic artist",
    text: "Looking for a comic artist for a 10-page short. Budget is $800. DM me!",
    url: "https://www.facebook.com/groups/x/posts/1122334455/",
    time: "2026-08-10T12:00:00.000Z",
  };
  const lead = mapFacebookPost(item, null);
  assert.equal(lead.post_id, "fb_1122334455");
  assert.equal(lead.platform, "Facebook");
  assert.equal(lead.source, "Freelance Illustrators Hub");
  assert.equal(lead.author, "Maria Lopez");
  assert.equal(lead.budget, "$800");
  assert.equal(lead.quality, "High Quality");
  assert.equal(lead.created_at, "2026-08-10T12:00:00.000Z");
});

check("facebook: epoch timestamp normalizes to ISO Z", () => {
  const item = {
    id: "999",
    groupTitle: "G",
    user: { name: "A" },
    text: "Random chatter, no intent here.",
    url: "https://facebook.com/groups/g/posts/999/",
    timestamp: 1754827200, // seconds
  };
  const lead = mapFacebookPost(item, null);
  assert.ok(lead.created_at.endsWith("Z"));
  assert.equal(lead.quality, "Low");
  assert.equal(lead.budget, "unknown");
});

check("facebook: skips item with no id/url/text", () => {
  assert.equal(mapFacebookPost({ text: "" }, null), null);
});

// --- Instagram ---
check("instagram: hashtag run uses sourceLabel + builds URL from shortCode", () => {
  const item = {
    shortCode: "Cabc123",
    caption: "Need an illustrator for my book cover, willing to pay €250.",
    ownerUsername: "jane_writes",
    timestamp: "2026-08-12T09:15:00Z",
    // no url on purpose → should be derived
  };
  const lead = mapInstagramPost(item, "#hireanartist");
  assert.equal(lead.post_id, "ig_Cabc123");
  assert.equal(lead.source, "#hireanartist");
  assert.equal(lead.author, "@jane_writes");
  assert.equal(lead.url, "https://www.instagram.com/p/Cabc123/");
  assert.equal(lead.budget, "€250");
  assert.equal(lead.quality, "High Quality");
});

check("instagram: falls back to @handle as source when no label", () => {
  const item = {
    id: "42",
    shortCode: "Cxyz",
    caption: "just a photo",
    ownerUsername: "someone",
    url: "https://www.instagram.com/p/Cxyz/",
    timestamp: "2026-08-01T00:00:00Z",
  };
  const lead = mapInstagramPost(item, null);
  assert.equal(lead.source, "@someone");
  assert.equal(lead.quality, "Low");
});

// --- Threads ---
check("threads: maps search result and builds post URL", () => {
  const item = {
    post_code: "C9zzz",
    text_content: "Hiring a logo designer this week, quote me your rate.",
    username: "startup_ben",
    created_at_timestamp: 1754999999,
  };
  const lead = mapThreadsPost(item, "need a logo designer");
  assert.equal(lead.post_id, "threads_C9zzz");
  assert.equal(lead.source, "need a logo designer");
  assert.equal(lead.author, "@startup_ben");
  assert.equal(lead.url, "https://www.threads.net/@startup_ben/post/C9zzz");
  assert.ok(lead.created_at.endsWith("Z"));
  assert.equal(lead.quality, "Medium"); // intent, no budget
});

check("threads: prefers explicit post_url when present", () => {
  const item = {
    post_code: "C1",
    post_url: "https://www.threads.net/@u/post/C1",
    text_content: "commissions open!",
    username: "u",
    created_at: "2026-08-05T05:00:00Z",
  };
  const lead = mapThreadsPost(item, null);
  assert.equal(lead.url, "https://www.threads.net/@u/post/C1");
  assert.equal(lead.source, "@u");
});

console.log(`\n${passed} checks passed.`);
