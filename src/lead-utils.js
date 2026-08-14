// Shared helpers for turning raw scraper output into Scout leads.
//
// The Scout leads.json contract (see README) requires every lead to carry
// these string fields: post_id, platform, source, author, title, content,
// url, quality, budget, created_at. quality must be exactly one of
// "High Quality", "Medium", or "Low". created_at must be ISO 8601 with a Z.

export const QUALITY = {
  HIGH: "High Quality",
  MEDIUM: "Medium",
  LOW: "Low",
};

// ---------------------------------------------------------------------------
// Intent classification
//
// The goal is to keep only posts where a CLIENT is looking to hire/pay an
// artist, and drop:
//   • artists advertising their own services ("commissions open", "for hire")
//   • closed / fulfilled / outdated requests ("found someone", "comms closed")
//   • vague posts with no hiring signal at all
//
// Each set is overridable via config (strongHireKeywords, includeKeywords,
// excludeKeywords, closedKeywords).
// ---------------------------------------------------------------------------

// Unambiguous "a client wants to pay" signals — these WIN over artist-ad
// signals when both appear (e.g. "hiring an artist, commissions welcome").
export const DEFAULT_STRONG_HIRE = [
  "looking to hire",
  "want to hire",
  "wanting to hire",
  "we are hiring",
  "we're hiring",
  "now hiring",
  "hiring a ",
  "hiring an ",
  "will pay",
  "willing to pay",
  "happy to pay",
  "paid gig",
  "paid commission",
  "paid project",
  "budget is",
  "budget of",
  "my budget",
  "[paid]",
  "commission an artist",
  "commission an illustrator",
  "to commission an",
  "to commission a",
];

// Weaker client-side signals (kept only if no artist-ad signal is present).
export const DEFAULT_INCLUDE = [
  "hiring",
  "looking for an artist",
  "looking for a artist",
  "looking for an illustrator",
  "looking for a illustrator",
  "looking for a designer",
  "looking for a graphic designer",
  "looking for a logo",
  "looking for someone to draw",
  "looking for someone to design",
  "looking for someone to make",
  "need an artist",
  "need a artist",
  "need artist",
  "need an illustrator",
  "need illustrator",
  "need a designer",
  "need designer",
  "need a graphic designer",
  "need a logo",
  "who can draw",
  "who can design",
  "recommend an artist",
  "recommend an illustrator",
  "paying artist",
  "paying illustrator",
  "paying designer",
  "seeking an artist",
  "seeking artist",
  "in search of an artist",
  "anyone available to draw",
  "anyone who can draw",
];

// Artist self-promotion signals (a creator selling their services). Drop.
export const DEFAULT_EXCLUDE = [
  "for hire",
  "[for hire]",
  "[fh]",
  "commissions open",
  "commission open",
  "comms open",
  "commissions are open",
  "open for commission",
  "open for commissions",
  "open commissions",
  "taking commission",
  "taking commissions",
  "accepting commission",
  "accepting commissions",
  "commission sheet",
  "comm sheet",
  "commission slots",
  "slots open",
  "slots available",
  "slots left",
  "dm for commission",
  "dm for a commission",
  "dm for prices",
  "dm for pricing",
  "dm for portfolio",
  "dm to commission",
  "dm me to order",
  "message me to order",
  "my portfolio",
  "my commission",
  "my commissions",
  "my price",
  "my prices",
  "price list",
  "price sheet",
  "prices below",
  "ko-fi",
  "kofi",
  "patreon",
  "buymeacoffee",
  "commissionsopen",
  "artistforhire",
  "openforcommissions",
  "available for work",
  "available for commission",
  "available for hire",
  "now booking",
  "booking now",
  "commissions available",
  "link in bio",
];

// Closed / fulfilled / outdated requests. Drop.
export const DEFAULT_CLOSED = [
  "commissions closed",
  "commission closed",
  "comms closed",
  "closed for commission",
  "found someone",
  "found an artist",
  "found my artist",
  "no longer looking",
  "no longer available",
  "position filled",
  "role filled",
  "all slots taken",
  "fully booked",
  "update: found",
  "we found someone",
  "i found someone",
  "sold out",
  "this is now closed",
];

/** Back-compat alias (used by older callers/tests). */
export const DEFAULT_LEAD_KEYWORDS = DEFAULT_INCLUDE;

/**
 * Classify a post's intent from its text:
 *   "client"    → a client looking to hire/pay (keep)
 *   "artist_ad" → an artist advertising services (drop)
 *   "closed"    → a fulfilled/closed/outdated request (drop)
 *   "unknown"   → no hiring signal; vague/non-committal (drop)
 */
export function classifyIntent(text, opts = {}) {
  const {
    strong = DEFAULT_STRONG_HIRE,
    include = DEFAULT_INCLUDE,
    exclude = DEFAULT_EXCLUDE,
    closed = DEFAULT_CLOSED,
  } = opts;
  const t = normalize(text).toLowerCase();
  const has = (list) => list.some((k) => t.includes(k.toLowerCase()));

  if (has(closed)) return "closed";
  if (has(strong)) return "client"; // strong client signal wins over ads
  if (has(exclude)) return "artist_ad";
  if (has(include)) return "client";
  return "unknown";
}

// Matches common budget mentions: "$300", "€250", "£500", "$25-30",
// "25-30$", "1,200 USD", "500 dollars". Returns the first match, normalized.
const BUDGET_RE =
  /([$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?-\s?[$€£]?\s?\d[\d,]*(?:\.\d+)?)?|\d[\d,]*(?:\.\d+)?\s?-?\s?\d*\s?[$€£]|\d[\d,]*(?:\.\d+)?\s?(?:usd|eur|gbp|dollars?|euros?|pounds?))/i;

/**
 * Normalize any timestamp-ish value to ISO 8601 with a trailing Z.
 * Accepts ISO strings, epoch seconds, or epoch milliseconds.
 */
export function toIso(value) {
  if (value === null || value === undefined || value === "") {
    return new Date().toISOString();
  }
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value; // seconds vs. milliseconds
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Collapse whitespace and trim. */
export function clean(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

/** Derive a short single-line title from a post body. */
export function deriveTitle(text, max = 90) {
  if (!text) return "Untitled post";
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
  const base = clean(firstLine) || clean(text);
  if (!base) return "Untitled post";
  return base.length > max ? base.slice(0, max - 1).trimEnd() + "…" : base;
}

/**
 * NFKC folds "fancy" Unicode (mathematical-bold/italic letters and digits
 * common in IG captions, e.g. "𝟓𝟖 𝐔𝐒𝐃") down to plain ASCII so budget and
 * keyword detection can see it.
 */
function normalize(text) {
  return String(text || "").normalize("NFKC");
}

/** Pull a budget string out of free text, or "unknown" if none found. */
export function detectBudget(text) {
  if (!text) return "unknown";
  const m = normalize(text).match(BUDGET_RE);
  return m ? clean(m[0]) : "unknown";
}

/**
 * Quality score for a classified lead:
 *   High Quality → client intent AND a budget was found
 *   Medium       → client intent, no budget
 *   Low          → not a client lead (only reachable when clientLeadsOnly=false)
 */
export function scoreQuality(intent, budget) {
  if (intent !== "client") return QUALITY.LOW;
  const hasBudget = Boolean(budget) && budget !== "unknown";
  return hasBudget ? QUALITY.HIGH : QUALITY.MEDIUM;
}

/**
 * Assemble a validated Scout lead from partial fields, filling budget /
 * quality / title automatically when not supplied.
 *
 * Returns null when the lead lacks the minimum needed (id, url, text) OR —
 * when opts.clientLeadsOnly is true (the default) — when the post isn't a
 * genuine client hiring request (artist ad, closed, or vague).
 *
 * opts: { strong, include, exclude, closed, clientLeadsOnly }
 */
export function buildLead(partial, opts = {}) {
  const clientLeadsOnly = opts.clientLeadsOnly !== false;

  const content = clean(partial.content);
  const url = clean(partial.url);
  const rawId = partial.post_id ? String(partial.post_id) : "";
  if (!rawId || !url || !content) return null;

  const intent = classifyIntent(content, opts);
  if (clientLeadsOnly && intent !== "client") return null;

  const budget =
    partial.budget && partial.budget !== "unknown"
      ? clean(partial.budget)
      : detectBudget(content);

  const lead = {
    post_id: rawId,
    platform: clean(partial.platform) || "Unknown",
    source: clean(partial.source) || "Unknown",
    author: clean(partial.author) || "Unknown",
    title: clean(partial.title) || deriveTitle(content),
    content,
    url,
    quality: partial.quality || scoreQuality(intent, budget),
    budget,
    created_at: toIso(partial.created_at),
  };
  return lead;
}

/** Dedupe leads by post_id, keeping the first occurrence. */
export function dedupeById(leads) {
  const seen = new Set();
  const out = [];
  for (const lead of leads) {
    if (!lead || !lead.post_id || seen.has(lead.post_id)) continue;
    seen.add(lead.post_id);
    out.push(lead);
  }
  return out;
}

/** Newest-first by created_at. */
export function sortNewestFirst(leads) {
  return [...leads].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
