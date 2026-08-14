// Per-platform mappers. Each takes a raw dataset item from its Apify actor
// plus an optional `sourceLabel` (the search term / group / handle the run
// targeted) and returns a partial lead for buildLead(), or null to skip.
//
// Field references verified against each actor's inferred output schema:
//   scraper_one/facebook-posts-search, apify/instagram-scraper,
//   futurizerush/meta-threads-scraper.

import { buildLead, deriveTitle } from "./lead-utils.js";

/** Facebook Posts Search (scraper_one/facebook-posts-search) → lead */
export function mapFacebookPost(item, sourceLabel, opts) {
  const text = item.postText || "";
  const id = item.postId;
  return buildLead(
    {
      post_id: id ? `fb_${id}` : "",
      platform: "Facebook",
      source: sourceLabel || "Facebook Search",
      author: item.author?.name || "Unknown",
      title: deriveTitle(text),
      content: text,
      url: item.url,
      created_at: item.timestamp, // epoch milliseconds
    },
    opts
  );
}

/** Derive an Instagram card source: the hashtag it came from, else @handle. */
function instagramSource(item) {
  // When hashtags are batched into one run, each item carries the explore URL
  // it was scraped from (e.g. .../explore/tags/hireanartist/).
  const m = (item.inputUrl || "").match(/\/explore\/tags\/([^/?#]+)/i);
  if (m) return `#${decodeURIComponent(m[1])}`;
  return item.ownerUsername ? `@${item.ownerUsername}` : "Instagram";
}

/** Instagram Scraper → lead (posts/reels from hashtag search or profile) */
export function mapInstagramPost(item, sourceLabel, opts) {
  const text = item.caption || "";
  const id = item.shortCode || item.id;
  // Prefer an explicit run label; otherwise derive from the item (hashtag
  // via inputUrl when batched, else the author handle).
  const source = sourceLabel || instagramSource(item);
  return buildLead(
    {
      post_id: id ? `ig_${id}` : "",
      platform: "Instagram",
      source,
      author: item.ownerUsername ? `@${item.ownerUsername}` : item.ownerFullName || "Unknown",
      title: deriveTitle(text),
      content: text,
      url: item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : ""),
      created_at: item.timestamp,
    },
    opts
  );
}

/** Threads Scraper → lead (search results or user posts) */
export function mapThreadsPost(item, sourceLabel, opts) {
  // Skip pure reposts with no original text of their own.
  const text = item.text_content || "";
  const id = item.post_code || item.post_id;
  const source = sourceLabel || item.search_keyword || (item.username ? `@${item.username}` : "Threads");
  return buildLead(
    {
      post_id: id ? `threads_${id}` : "",
      platform: "Threads",
      source,
      author: item.username ? `@${item.username}` : item.display_name || "Unknown",
      title: deriveTitle(text),
      content: text,
      url: item.post_url || (item.username && item.post_code
        ? `https://www.threads.net/@${item.username}/post/${item.post_code}`
        : ""),
      created_at: item.created_at_timestamp ?? item.created_at,
    },
    opts
  );
}

export const MAPPERS = {
  facebook: mapFacebookPost,
  instagram: mapInstagramPost,
  threads: mapThreadsPost,
};
