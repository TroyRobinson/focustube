import { NextRequest, NextResponse } from "next/server";

// Basic local denylist for obvious adult or highly suggestive terms
// Intentionally aggressive per product requirement to avoid revealing skin-tight outfits, swimsuits, etc.
const ADULT_BLOCK_TERMS = [
  // Explicit sexual content and services
  "porn",
  "porno",
  "pornhub",
  "xvideos",
  "xhamster",
  "pornography",
  "xxx",
  "nsfw",
  "hentai",
  "incest",
  "bestiality",
  "rape",
  "milf",
  "gilf",
  "teen",
  "lolita",
  "onlyfans",
  "fansly",
  "escort",
  "escorts",
  "prostitute",
  "prostitution",
  "hooker",
  "call girl",
  "camgirl",
  "camgirls",
  "camboy",
  "webcam",
  "camwhore",
  // Anatomy/sexual actions
  "sex",
  "sexual",
  "sexy",
  "hot girl",
  "hot girls",
  "hot woman",
  "hot women",
  "nude",
  "nudes",
  "nudity",
  "tits",
  "boobs",
  "breasts",
  "nipple",
  "nipples",
  "areola",
  "cleavage",
  "cameltoe",
  "ass",
  "butt",
  "butts",
  "buttocks",
  "booty",
  "anal",
  "deepthroat",
  "blowjob",
  "handjob",
  "fisting",
  "pegging",
  "gangbang",
  "cum",
  "orgasm",
  "edging",
  "kink",
  "kinky",
  "bdsm",
  "fetish",
  "dominatrix",
  "femdom",
  // Clothing and erotic content styles
  "lingerie",
  "underwear",
  "panties",
  "bra",
  "thong",
  "bikini",
  "swimsuit",
  "swimwear",
  "stockings",
  "fishnets",
  "yoga pants",
  "leggings",
  "sports bra",
  // Dance/strip-related
  "strip",
  "stripper",
  "strippers",
  "striptease",
  "lap dance",
  "lapdance",
  "pole dance",
  "pole dancing",
  "twerk",
  "twerking",
  "burlesque",
  // Fitness/athletic contexts (aggressive filter)
  "workout",
  "gym",
  "fitness",
  "athletic",
  "athletics",
  "yoga",
  "pilates",
  "zumba",
  "aerobics",
  "cheer",
  "cheerleader",
  "cheerleading",
  "gymnast",
  "gymnastics",
  // Casual/summer contexts with revealing outfits
  "beach",
  "swim",
  "swimming",
  "pool party",
  "sunbathing",
  // Performance/dance generic (aggressive filter)
  "dance",
  "dancer",
  "dancers",
  "dancing",
  // Suggestive descriptors
  "sensual",
  "seduce",
  "seductive",
  "seduction",
  "provocative",
  "thirst trap",
  "thirsttrap",
  "babe",
  "babes",
  "model",
  "supermodel",
];
const ADULT_BLOCK_RE = new RegExp(`\\b(${ADULT_BLOCK_TERMS.map(t => t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")})\\b`, "i");

// Cache moderation decisions per query (normalized), to avoid repeated API calls
const MOD_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h
type CacheEntry = { decision: "allow" | "block"; categories?: string[]; ts: number };
const moderationCache = new Map<string, CacheEntry>();

function normalizeQuery(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

// Circuit breaker for OpenAI rate limits
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
let RATE_LIMIT_UNTIL = 0;

type ModerationResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "flagged" | "unavailable" | "rate_limited";
      categories?: string[];
      debug?: { cause: "no_key" | "upstream" | "exception"; status?: number };
    };

async function moderateQuery(text: string): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  // Fail-closed: if moderation key is missing, do not allow the query
  if (!apiKey) {
    return { allowed: false, reason: "unavailable", debug: { cause: "no_key" } } as const;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: text.slice(0, 4000),
      }),
    });
    if (!res.ok) {
      // If rate limited, trip the breaker (handled by caller)
      if (res.status === 429) {
        return { allowed: false, reason: "rate_limited", debug: { cause: "upstream", status: res.status } } as const;
      }
      // Try legacy text model as a graceful fallback for accounts without omni access
      try {
        const legacy = await fetch("https://api.openai.com/v1/moderations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "text-moderation-latest",
            input: text.slice(0, 4000),
          }),
        });
        if (!legacy.ok) {
          return {
            allowed: false,
            reason: "unavailable",
            debug: { cause: "upstream", status: legacy.status },
          } as const;
        }
        const legacyData = await legacy.json();
        const legacyResult = legacyData?.results?.[0];
        const flagged = !!legacyResult?.flagged;
        const categories = legacyResult?.categories || {};
        const flaggedCategories = Object.entries(categories)
          .filter(([, v]) => !!v)
          .map(([k]) => k);
        return flagged
          ? ({ allowed: false, reason: "flagged", categories: flaggedCategories } as const)
          : ({ allowed: true } as const);
      } catch {
        return { allowed: false, reason: "unavailable", debug: { cause: "upstream", status: res.status } } as const;
      }
    }
    const data = await res.json();
    const result = data?.results?.[0];
    const flagged = !!result?.flagged;
    const categories = result?.categories || {};
    const flaggedCategories = Object.entries(categories)
      .filter(([, v]) => !!v)
      .map(([k]) => k);
    return flagged
      ? ({ allowed: false, reason: "flagged", categories: flaggedCategories } as const)
      : ({ allowed: true } as const);
  } catch {
    // Fail-closed on network/other errors
    return { allowed: false, reason: "unavailable", debug: { cause: "exception" } } as const;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const pageToken = (searchParams.get("pageToken") || "").trim();

  if (!q) {
    return NextResponse.json({ error: "Missing required query 'q'" }, { status: 400 });
  }

  const normQ = normalizeQuery(q);
  // 1) Local denylist short-circuit
  if (ADULT_BLOCK_RE.test(normQ)) {
    // cache as blocked to avoid repeated checks
    moderationCache.set(normQ, { decision: "block", categories: ["sexual"], ts: Date.now() });
    return NextResponse.json(
      {
        error: "Query blocked by content moderation",
        code: "MODERATION_BLOCKED",
        categories: ["sexual"],
      },
      { status: 422 },
    );
  }

  // 2) Cache check to avoid repeated moderation calls (e.g., pagination)
  const cached = moderationCache.get(normQ);
  if (cached && Date.now() - cached.ts < MOD_CACHE_TTL_MS) {
    if (cached.decision === "block") {
      return NextResponse.json(
        {
          error: "Query blocked by content moderation",
          code: "MODERATION_BLOCKED",
          categories: cached.categories ?? [],
        },
        { status: 422 },
      );
    }
    // allowed -> continue to YouTube without another moderation call
  }

  // 3) If we recently hit rate limits, skip moderation calls and rely on denylist
  if (Date.now() < RATE_LIMIT_UNTIL) {
    // Do not call OpenAI during cooldown; proceed only if it passes denylist
    // Optionally, we could add lightweight heuristics here.
    // Continue to YouTube.
  } else {
    // Content moderation pre-check on the user's search query
    const moderation = await moderateQuery(q);
    if (!moderation.allowed) {
      if (moderation.reason === "flagged") {
        // cache the decision
        moderationCache.set(normQ, { decision: "block", categories: moderation.categories ?? [], ts: Date.now() });
        return NextResponse.json(
          {
            error: "Query blocked by content moderation",
            code: "MODERATION_BLOCKED",
            categories: moderation.categories ?? [],
          },
          { status: 422 },
        );
      }
      if (moderation.reason === "rate_limited") {
        // Trip breaker and degrade gracefully: rely on denylist and YouTube safeSearch
        RATE_LIMIT_UNTIL = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        // fall through to proceed without moderation
      } else {
        // Moderation unavailable -> fail-closed
        return NextResponse.json(
          {
            error: "Search temporarily unavailable (moderation unavailable)",
            code: "MODERATION_UNAVAILABLE",
            // In dev, include a hint to speed up debugging
            ...(process.env.NODE_ENV !== "production"
              ? { details: moderation.debug }
              : {}),
          },
          { status: 503 },
        );
      }
    } else {
      // cache allow decision
      moderationCache.set(normQ, { decision: "allow", ts: Date.now() });
    }
  }

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Missing YOUTUBE_API_KEY (set it in .env.local)" },
      { status: 500 },
    );
  }

  const params = new URLSearchParams({
    key,
    q,
    type: "video",
    part: "snippet",
    maxResults: "12",
  });
  // Ask YouTube to apply its own strict SafeSearch on results as well
  params.set("safeSearch", "strict");
  if (pageToken) params.set("pageToken", pageToken);

  const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      const text = await r.text();
      return NextResponse.json(
        { error: "YouTube API error", details: text },
        { status: r.status },
      );
    }
    const data = await r.json();
    const items = (data.items || [])
      .map((it: any) => ({
        id: it?.id?.videoId ?? "",
        title: it?.snippet?.title ?? "",
        channelTitle: it?.snippet?.channelTitle ?? "",
        publishedAt: it?.snippet?.publishedAt ?? "",
        thumbnail:
          it?.snippet?.thumbnails?.medium?.url ||
          it?.snippet?.thumbnails?.default?.url ||
          "",
      }))
      .filter((v: any) => v.id);

    return NextResponse.json({
      items,
      nextPageToken: data.nextPageToken ?? null,
      prevPageToken: data.prevPageToken ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
