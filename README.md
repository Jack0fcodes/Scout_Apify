# Scout_Apify

Apify → Scout lead pipeline. It scrapes **public Meta posts** (Facebook Groups,
Instagram, Threads) with [Apify](https://apify.com) actors, transforms them into
Scout's `leads.json` schema, and commits the result here so the **Scout app can
fetch it from the raw GitHub endpoint** — the same pattern as your `redd0tBot`
and `Scout_Grok` sources.

```
┌────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌───────────┐
│ Apify      │   │ src/scrape.js    │   │ leads.json   │   │ Scout app │
│ actors     │──▶│ map → dedupe →   │──▶│ (this repo,  │──▶│ (fetches  │
│ FB/IG/TH   │   │ sort → cap       │   │ committed)   │   │ raw JSON) │
└────────────┘   └──────────────────┘   └──────────────┘   └───────────┘
        run every 6h by .github/workflows/scout.yml
```

## What Scout fetches

Add this repo's raw endpoint as a 3rd source in Scout's `LeadStore.swift`:

```
https://raw.githubusercontent.com/Jack0fcodes/Scout_Apify/main/leads.json
```

(Scout merges + dedupes all sources by `post_id`, so Meta leads slot in
alongside the Reddit/X ones.)

## The `leads.json` contract

A top-level JSON **array** of lead objects. Every field is a **string** and
every field is required:

| Key          | Notes                                                              |
| ------------ | ------------------------------------------------------------------ |
| `post_id`    | Unique. Prefixed per platform: `fb_`, `ig_`, `threads_`.           |
| `platform`   | `Facebook`, `Instagram`, or `Threads`.                             |
| `source`     | The group / hashtag / handle the post came from (shown on card).   |
| `author`     | Poster's name or `@handle`.                                        |
| `title`      | Post title, or first line of the body when there's no title.       |
| `content`    | Full post body. Also scanned for a budget.                         |
| `url`        | Direct link to the post.                                           |
| `quality`    | Exactly `High Quality`, `Medium`, or `Low` (case-sensitive).       |
| `budget`     | e.g. `$300`, `€250`, a range, or `unknown`.                        |
| `created_at` | ISO 8601 with `Z`, e.g. `2026-08-10T12:00:00.000Z`.               |

`quality` and `budget` are derived automatically:

- **budget** — first currency amount found in the post (`$300`, `€250`,
  `£500`, `$25-30`, `1,200 USD`, …), else `unknown`.
- **quality** — `High Quality` when a client lead has a budget; `Medium` when
  it doesn't. (`Low` only appears if you disable filtering — see below.)

## Lead filtering (digital-art client leads only)

The pipeline keeps only posts where a **client is looking to hire/pay for
digital art / illustration**. A post runs through this chain (first match
wins), and only `client` is kept:

1. **Block** (`blockKeywords`) → drop. Off-topic subjects and non-art fields —
   tattoo, PMU/permanent makeup, hair, nails, housing/lease, voice acting.
   Runs first, so it beats even a strong hire signal
   (e.g. "hiring a tattoo artist, will pay").
2. **Closed** (`closedKeywords`) → drop. "found someone", "commissions
   closed", "position filled", …
3. **Art-role gate** (`artRoleKeywords`) → must mention art (illustrator,
   character/concept art, comic, drawing, commission…) or it's dropped as
   `non_art`. This removes reel-editor / VA / generic hires.
4. **Graphic-design demotion** (`deprioritizeKeywords` vs `coreArtKeywords`) →
   a graphic-design / logo / brand post is dropped unless it also names a
   **core** digital-art role (illustration, character art, comic, …). Keeps
   digital art the priority over plain graphic design.
5. **Strong hire** (`strongHireKeywords`) → keep, even if ad phrases are also
   present ("looking to hire", "will pay", "budget is").
6. **Artist ad** (`excludeKeywords`) → drop. "commissions open", "for hire",
   "DM for prices", "my portfolio", plus first-person self-promo
   ("I create…", "hire me", "for your story/project").
7. **Client** (`includeKeywords`) → keep. "need an illustrator", "who can
   draw", "paying artist", …
8. Otherwise → drop as vague.

Every keyword set above is editable in `config.json`. To keep **everything**
and just label quality instead of dropping, set `"clientLeadsOnly": false`.

> Note: this is keyword-based, so it's high-precision but not perfect —
> a rare off-topic post that happens to contain the right phrase can slip
> through (or a good one get dropped). Tighten the lists to taste.

## Configure what gets scraped

Edit [`config.json`](./config.json):

```jsonc
{
  "maxLeads": 250,            // cap on the committed list
  "keepExisting": true,      // merge new scrapes with the current leads.json
  "onlyPostsNewerThan": "14 days",
  "leadKeywords": ["looking for", "hiring", "commission", ...],
  "sources": {
    "facebook": {
      "enabled": true,
      "keywords": ["looking for an illustrator", "need a graphic designer"]
    },
    "instagram": {
      "enabled": true,
      "hashtags": ["#hireanartist", "#artcommission"],
      "profileUrls": []        // optional: scrape specific profiles
    },
    "threads": {
      "enabled": true,
      "keywords": ["need a logo designer", "looking for an illustrator"],
      "usernames": []          // optional: scrape specific users
    }
  }
}
```

Each hashtag / keyword / profile becomes its own actor run so the card's
`source` label stays accurate. Set any source's `enabled` to `false` to skip it.

### Actors used

| Source    | Actor                                 | How it's targeted        |
| --------- | ------------------------------------- | ------------------------ |
| Facebook  | `scraper_one/facebook-posts-search`   | keyword search           |
| Instagram | `apify/instagram-scraper`             | hashtag / profile URL    |
| Threads   | `futurizerush/meta-threads-scraper`   | keyword search / user    |

All three are **search-driven** — each keyword/hashtag finds matching public
posts across the platform, so you discover new leads without knowing specific
groups or accounts in advance.

## Running it

### Automatically (GitHub Actions)

`.github/workflows/scout.yml` runs every 6 hours (and on-demand via **Run
workflow**). It scrapes, validates, and commits `leads.json` only when it
changed.

**One-time setup:** add your Apify API token as a repo secret named
`APIFY_TOKEN` (Settings → Secrets and variables → Actions → New repository
secret). Get the token from Apify Console → Settings → Integrations.

### Locally

```bash
npm install
export APIFY_TOKEN=apify_api_xxx
npm run scrape      # scrape + rewrite leads.json
npm run validate    # check leads.json against the contract
npm test            # offline mapper tests (no token needed)
```

## Project layout

```
config.json                  # what to scrape
leads.json                   # the published feed (committed by the workflow)
src/scrape.js                # orchestrator: run actors → map → merge → write
src/mappers.js               # per-platform raw item → lead
src/lead-utils.js            # budget/quality/title/date helpers + validation
src/validate.js              # leads.json contract checker
src/mappers.test.js          # offline tests
.github/workflows/scout.yml  # scheduled scrape + commit
.github/workflows/ci.yml     # test + validate on push/PR
```

## Notes

- Only **public** groups/profiles/posts are scraped.
- If one run fails but others succeed, the good leads still ship. Only if
  **every** run fails does the existing `leads.json` stay untouched.
- New scrapes win over older duplicates (fresher content, quality, budget),
  and the list is sorted newest-first and capped at `maxLeads`.
