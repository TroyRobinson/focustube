import { NextRequest, NextResponse } from "next/server";

async function moderateQuery(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  // If no key, skip moderation (fail-open)
  if (!apiKey) {
    return { allowed: true, skipped: true } as const;
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
      // Do not block on upstream failures
      return { allowed: true, error: `Moderation upstream ${res.status}` } as const;
    }
    const data = await res.json();
    const result = data?.results?.[0];
    const flagged = !!result?.flagged;
    const categories = result?.categories || {};
    const flaggedCategories = Object.entries(categories)
      .filter(([, v]) => !!v)
      .map(([k]) => k);
    return {
      allowed: !flagged,
      flagged,
      categories: flaggedCategories,
    } as const;
  } catch {
    // Network/other error – do not block
    return { allowed: true, error: "Moderation request failed" } as const;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const pageToken = (searchParams.get("pageToken") || "").trim();

  if (!q) {
    return NextResponse.json({ error: "Missing required query 'q'" }, { status: 400 });
  }

  // Content moderation pre-check on the user's search query
  const moderation = await moderateQuery(q);
  if (!moderation.allowed) {
    return NextResponse.json(
      {
        error: "Query blocked by content moderation",
        code: "MODERATION_BLOCKED",
        categories: moderation.categories ?? [],
      },
      { status: 422 },
    );
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
