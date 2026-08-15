#!/usr/bin/env node
// Offline sanity tests for the mappers + intent classifier — no Apify token
// or network needed. Uses representative sample items shaped like each
// actor's real output. Run: npm test

import assert from "node:assert/strict";
import { mapFacebookPost, mapInstagramPost, mapThreadsPost } from "./mappers.js";
import { classifyIntent, isFreshEnough } from "./lead-utils.js";

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

// --- Intent classifier ---
check("classify: client hiring with budget → client", () => {
  assert.equal(classifyIntent("Hiring an illustrator, my budget is $500"), "client");
});
check("classify: 'looking for an illustrator' → client", () => {
  assert.equal(classifyIntent("Looking for an illustrator for my book cover"), "client");
});
check("classify: artist advertising 'commissions open' → artist_ad", () => {
  assert.equal(classifyIntent("Commissions open! DM for prices, check my portfolio"), "artist_ad");
});
check("classify: 'for hire' artist post → artist_ad", () => {
  assert.equal(classifyIntent("Illustrator for hire, slots available now"), "artist_ad");
});
check("classify: strong hire signal beats an ad phrase → client", () => {
  // Contains "commissions open" (ad) but also "will pay" (strong client).
  assert.equal(classifyIntent("We're hiring, will pay well. Commissions open to all."), "client");
});
check("classify: fulfilled request → closed", () => {
  assert.equal(classifyIntent("UPDATE: found someone, thanks everyone!"), "closed");
});
check("classify: vague post with no signal → unknown", () => {
  assert.equal(classifyIntent("Check out this cool character art I made"), "unknown");
});
check("classify: tattoo hiring is blocked even with a strong hire signal", () => {
  assert.equal(classifyIntent("NOW HIRING: tattoo artist, will pay $40/hr"), "off_topic");
});
check("classify: PMU / permanent makeup hire → off_topic", () => {
  assert.equal(classifyIntent("Hiring a PMU instructor, budget is $45/hr"), "off_topic");
});
check("classify: apartment post that mentions an illustrator → off_topic", () => {
  assert.equal(
    classifyIntent("Looking for an illustrator to join our lease, budget $1500 rent"),
    "off_topic"
  );
});
check("classify: digital illustration hire still passes → client", () => {
  assert.equal(classifyIntent("Hiring an illustrator for a book cover, will pay"), "client");
});
check("classify: non-art hire (reel editor) → non_art", () => {
  assert.equal(classifyIntent("Now hiring a reel editor, will pay weekly"), "non_art");
});
check("classify: graphic-designer-only hire → non_art (deprioritized)", () => {
  assert.equal(classifyIntent("We're hiring a graphic designer for our brand"), "non_art");
});
check("classify: VA hire → non_art", () => {
  assert.equal(classifyIntent("Hiring a virtual assistant, budget is $500/mo"), "non_art");
});
check("classify: 'looking for an artist to draw my OC' → client", () => {
  assert.equal(classifyIntent("Looking for an artist to draw my OC, will pay"), "client");
});
check("classify: 'graphic artist' with artwork but no core art → non_art (demoted)", () => {
  assert.equal(
    classifyIntent("We're hiring a graphic artist to make artwork for our brand"),
    "non_art"
  );
});
check("classify: illustrator + graphic designer together → client (core art present)", () => {
  assert.equal(
    classifyIntent("Hiring an illustrator and graphic designer for our comic, will pay"),
    "client"
  );
});
check("classify: artist self-promo phrased as 'for your story' → artist_ad", () => {
  assert.equal(
    classifyIntent("I create illustrations and character designs. Looking for an illustrator for your story? DM me!"),
    "artist_ad"
  );
});

// --- Freshness cap ---
check("freshness: a 2-month-old lead is dropped at 14 days", () => {
  const old = { created_at: new Date(Date.now() - 60 * 86400000).toISOString() };
  assert.equal(isFreshEnough(old, 14), false);
});
check("freshness: a 3-day-old lead is kept at 14 days", () => {
  const recent = { created_at: new Date(Date.now() - 3 * 86400000).toISOString() };
  assert.equal(isFreshEnough(recent, 14), true);
});
check("freshness: no cap (undefined days) keeps everything", () => {
  const old = { created_at: "2020-01-01T00:00:00Z" };
  assert.equal(isFreshEnough(old, undefined), true);
});

// --- Facebook Posts Search ---
check("facebook: client hiring post with budget → High Quality", () => {
  const lead = mapFacebookPost(
    {
      postId: "1122334455",
      author: { name: "Maria Lopez" },
      postText: "Looking for an illustrator for a 10-page short. Budget is $800. DM me!",
      url: "https://www.facebook.com/maria/posts/1122334455",
      timestamp: 1786644261000, // epoch ms
    },
    "looking for an illustrator"
  );
  assert.equal(lead.post_id, "fb_1122334455");
  assert.equal(lead.source, "looking for an illustrator");
  assert.equal(lead.budget, "$800");
  assert.equal(lead.quality, "High Quality");
  assert.ok(lead.created_at.endsWith("Z"));
});

check("facebook: artist ad is dropped (clientLeadsOnly default)", () => {
  const lead = mapFacebookPost(
    {
      postId: "999",
      author: { name: "Art By Sam" },
      postText: "Commissions open! Taking commissions now, DM for prices 🎨",
      url: "https://facebook.com/sam/posts/999",
      timestamp: 1786644261000,
    },
    "hiring an artist"
  );
  assert.equal(lead, null);
});

check("facebook: non-client post kept as Low when clientLeadsOnly=false", () => {
  const lead = mapFacebookPost(
    {
      postId: "77",
      author: { name: "Sam" },
      postText: "Just sharing my latest painting, no ask here.",
      url: "https://facebook.com/sam/posts/77",
      timestamp: 1786644261000,
    },
    "hiring an artist",
    { clientLeadsOnly: false }
  );
  assert.equal(lead.quality, "Low");
});

// --- Instagram ---
check("instagram: client post with fancy-Unicode budget → High Quality", () => {
  const lead = mapInstagramPost(
    {
      shortCode: "Cabc123",
      caption: "Hiring an illustrator for my book cover, budget is 𝟐𝟓𝟎 𝐔𝐒𝐃. DM me!",
      ownerUsername: "jane_writes",
      timestamp: "2026-08-12T09:15:00Z",
    },
    "#hireanartist"
  );
  assert.equal(lead.post_id, "ig_Cabc123");
  assert.equal(lead.source, "#hireanartist");
  assert.equal(lead.url, "https://www.instagram.com/p/Cabc123/");
  assert.equal(lead.budget, "250 USD");
  assert.equal(lead.quality, "High Quality");
});

check("instagram: artist 'commissions open' caption is dropped", () => {
  const lead = mapInstagramPost(
    {
      shortCode: "Cxyz",
      caption: "𝗖𝗢𝗠𝗠𝗜𝗦𝗦𝗜𝗢𝗡𝗦 𝗢𝗣𝗘𝗡! Custom art, DM to commission #artcommission",
      ownerUsername: "someone",
      url: "https://www.instagram.com/p/Cxyz/",
      timestamp: "2026-08-01T00:00:00Z",
    },
    "#artcommission"
  );
  assert.equal(lead, null);
});

check("instagram: batched run recovers the hashtag source from inputUrl", () => {
  const lead = mapInstagramPost(
    {
      shortCode: "Cbatch1",
      caption: "Looking for an illustrator to draw my D&D character, will pay!",
      ownerUsername: "dm_dave",
      timestamp: "2026-08-12T09:15:00Z",
      inputUrl: "https://www.instagram.com/explore/tags/hireanillustrator/",
      // no sourceLabel passed (batched run)
    },
    null
  );
  assert.equal(lead.source, "#hireanillustrator");
  assert.equal(lead.author, "@dm_dave");
});

// --- Threads ---
check("threads: client search result → Medium (intent, no budget)", () => {
  const lead = mapThreadsPost(
    {
      post_code: "C9zzz",
      text_content: "We're hiring an illustrator for a comic this week, DM me your rate.",
      username: "startup_ben",
      created_at_timestamp: 1786644261,
    },
    "hiring an illustrator"
  );
  assert.equal(lead.post_id, "threads_C9zzz");
  assert.equal(lead.source, "hiring an illustrator");
  assert.equal(lead.author, "@startup_ben");
  assert.equal(lead.url, "https://www.threads.net/@startup_ben/post/C9zzz");
  assert.equal(lead.quality, "Medium");
});

check("threads: artist 'for hire' post is dropped", () => {
  const lead = mapThreadsPost(
    {
      post_code: "C1",
      post_url: "https://www.threads.net/@u/post/C1",
      text_content: "Illustrator for hire! Commissions available, link in bio.",
      username: "u",
      created_at: "2026-08-05T05:00:00Z",
    },
    null
  );
  assert.equal(lead, null);
});

console.log(`\n${passed} checks passed.`);
