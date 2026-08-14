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

// Default hiring-intent keywords. Overridable via config.leadKeywords.
export const DEFAULT_LEAD_KEYWORDS = [
  "looking for",
  "need a",
  "need an",
  "hiring",
  "for hire",
  "commission",
  "budget",
  "paid",
  "willing to pay",
  "dm me",
  "quote",
  "freelanc",
  "who can",
];

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
 * Heuristic quality score:
 *   High Quality → clear hiring intent AND a budget was found
 *   Medium       → hiring intent OR a budget (but not both)
 *   Low          → neither signal
 */
export function scoreQuality(text, budget, keywords = DEFAULT_LEAD_KEYWORDS) {
  const t = normalize(text).toLowerCase();
  const hasIntent = keywords.some((k) => t.includes(k.toLowerCase()));
  const hasBudget = Boolean(budget) && budget !== "unknown";
  if (hasIntent && hasBudget) return QUALITY.HIGH;
  if (hasIntent || hasBudget) return QUALITY.MEDIUM;
  return QUALITY.LOW;
}

/**
 * Assemble a validated Scout lead from partial fields, filling budget /
 * quality / title automatically when not supplied. Returns null if the
 * lead lacks the minimum needed to be useful (id, url, and some text).
 */
export function buildLead(partial, keywords = DEFAULT_LEAD_KEYWORDS) {
  const content = clean(partial.content);
  const url = clean(partial.url);
  const rawId = partial.post_id ? String(partial.post_id) : "";
  if (!rawId || !url || !content) return null;

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
    quality: partial.quality || scoreQuality(content, budget, keywords),
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
