"use client";

import React from "react";

// Daily play limit (localStorage-backed)
const MAX_DAILY_PLAYS = 5;
const STORAGE_KEY = "ft.dailyPlayCounter";

type PlayCounter = {
  date: string;
  count: number;
};

function todayKey() {
  // Local-day key so it resets per local calendar day
  return new Date().toDateString();
}

function readCounter(): PlayCounter {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const today = todayKey();
    if (!raw) return { date: today, count: 0 };
    const parsed = JSON.parse(raw) as PlayCounter;
    if (!parsed?.date || parsed.date !== today) {
      return { date: today, count: 0 };
    }
    return { date: parsed.date, count: Number(parsed.count) || 0 };
  } catch {
    return { date: todayKey(), count: 0 };
  }
}

function writeCounter(counter: PlayCounter) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counter));
  } catch {
    // no-op
  }
}

function useDailyPlayLimit(max: number) {
  const [count, setCount] = React.useState(0);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const c = readCounter();
    setCount(c.count);
    setReady(true);
  }, []);

  const increment = React.useCallback(() => {
    setCount((prev) => {
      const next = Math.min(max, prev + 1);
      writeCounter({ date: todayKey(), count: next });
      return next;
    });
  }, [max]);

  const resetForToday = React.useCallback(() => {
    writeCounter({ date: todayKey(), count: 0 });
    setCount(0);
  }, []);

  const remaining = Math.max(0, max - count);
  const canPlay = ready && remaining > 0;

  return { count, remaining, canPlay, increment, resetForToday, ready } as const;
}

// Parse YouTube video URLs (full, shortened, embed, shorts, live)
function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Try to coerce into a URL; add https:// if missing
  let url: URL | null = null;
  try {
    url = new URL(trimmed);
  } catch {
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      url = null;
    }
  }
  if (!url) return null;

  const host = url.hostname.replace(/^www\./, "");

  // youtu.be/<id>
  if (host === "youtu.be") {
    const candidate = url.pathname.replace(/^\//, "").split("/")[0] || "";
    return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
  }

  // *.youtube.com paths
  if (host.endsWith("youtube.com")) {
    // watch?v=<id>
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    const parts = url.pathname.split("/").filter(Boolean);
    // /embed/<id>, /shorts/<id>, /live/<id>
    if (parts.length >= 2) {
      const [seg, id] = [parts[0], parts[1]];
      if (["embed", "shorts", "live"].includes(seg) && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return id;
      }
    }
  }

  return null;
}

type YTItem = {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
};

export default function App() {
  const limit = useDailyPlayLimit(MAX_DAILY_PLAYS);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<YTItem[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pageTokens, setPageTokens] = React.useState<{
    next: string | null;
    prev: string | null;
  }>({ next: null, prev: null });

  async function runSearch(q: string, token?: string) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ q });
      if (token) sp.set("pageToken", token);
      const res = await fetch(`/api/youtube?${sp.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        // Clear results and selection if blocked by moderation
        if (json?.code === "MODERATION_BLOCKED" || json?.code === "MODERATION_UNAVAILABLE") {
          setResults([]);
          setSelected(null);
          setError(
            json?.error ||
              (json?.code === "MODERATION_UNAVAILABLE"
                ? "Search unavailable: moderation unavailable"
                : "Search blocked by content policy"),
          );
          return;
        }
        throw new Error(json?.error || "Search failed");
      }
      setResults(json.items as YTItem[]);
      setPageTokens({
        next: json.nextPageToken ?? null,
        prev: json.prevPageToken ?? null,
      });
      if ((json.items as YTItem[]).length > 0) {
        // Only auto-select a video if the user still has plays left today
        if (limit.ready && limit.canPlay) {
          setSelected((json.items as YTItem[])[0].id);
        } else {
          setSelected(null);
        }
      } else {
        setSelected(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Search failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // If the query is a YouTube URL, play it (respecting daily limit)
    const urlId = extractYouTubeVideoId(query);
    if (urlId) {
      setError(null);
      if (!limit.canPlay && selected !== urlId) {
        setError("Daily play limit reached (5). Try again tomorrow.");
        return;
      }
      if (selected !== urlId) {
        limit.increment();
      }
      setSelected(urlId);
      return;
    }

    // Fallback to normal search
    runSearch(query);
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">FocusTube</h1>
          <form onSubmit={onSubmit} className="flex w-full max-w-xl items-center gap-2">
            {/* Daily plays counter badge */}
            <div
              className={`select-none rounded-md border px-2 py-1 text-xs font-medium ${
                limit.remaining === 0
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-gray-300 bg-gray-50 text-gray-700"
              }`}
              title={`Plays used today: ${limit.count}/${MAX_DAILY_PLAYS}`}
              aria-label={`Plays used today: ${limit.count} of ${MAX_DAILY_PLAYS}`}
            >
              {limit.count}/{MAX_DAILY_PLAYS}
            </div>
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 outline-none focus:border-gray-500"
              type="text"
              placeholder="Search YouTube or paste a video URL"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="rounded-md border-2 border-gray-800 bg-white px-4 py-2 font-medium hover:bg-gray-50 disabled:opacity-50"
              type="submit"
              disabled={loading}
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </form>
        </header>

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-700">
            {error}
          </div>
        )}

        {selected && (
          <div className="mb-6 aspect-video w-full overflow-hidden rounded-md border border-gray-300">
            <iframe
              className="h-full w-full"
              src={`https://www.youtube.com/embed/${selected}`}
              title="YouTube video player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
        )}

        <section>
          {results.length === 0 ? (
            selected ? null : (
              <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                Search for a video to get started.
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    if (!limit.canPlay) {
                      setError("Daily play limit reached (5). Try again tomorrow.");
                      return;
                    }
                    // Only count a play when switching to a new video
                    if (selected !== v.id) {
                      limit.increment();
                    }
                    setSelected(v.id);
                  }}
                  disabled={!limit.canPlay && selected !== v.id}
                  className={`group overflow-hidden rounded-md border text-left hover:shadow-md ${
                    selected === v.id ? "border-gray-800" : "border-gray-200"
                  } ${!limit.canPlay && selected !== v.id ? "opacity-60" : ""}`}
                >
                  <div className="aspect-video w-full overflow-hidden bg-gray-100">
                    {/* Use img to avoid Next image config */}
                    {v.thumbnail ? (
                      <img
                        src={v.thumbnail}
                        alt={v.title}
                        className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-gray-400">
                        No thumbnail
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="line-clamp-2 text-sm font-medium text-gray-900">
                      {v.title}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {v.channelTitle}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="mt-6 flex items-center justify-between">
          <button
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            disabled={!pageTokens.prev || loading || !query}
            onClick={() => runSearch(query, pageTokens.prev ?? undefined)}
          >
            Previous
          </button>
          <button
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            disabled={!pageTokens.next || loading || !query}
            onClick={() => runSearch(query, pageTokens.next ?? undefined)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
