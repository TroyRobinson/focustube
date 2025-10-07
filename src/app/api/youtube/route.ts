import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const pageToken = (searchParams.get("pageToken") || "").trim();

  if (!q) {
    return NextResponse.json({ error: "Missing required query 'q'" }, { status: 400 });
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

