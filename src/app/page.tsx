"use client";

import React from "react";

type YTItem = {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
};

export default function App() {
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
        throw new Error(json?.error || "Search failed");
      }
      setResults(json.items as YTItem[]);
      setPageTokens({
        next: json.nextPageToken ?? null,
        prev: json.prevPageToken ?? null,
      });
      if ((json.items as YTItem[]).length > 0) {
        setSelected((json.items as YTItem[])[0].id);
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
    runSearch(query);
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">FocusTube</h1>
          <form onSubmit={onSubmit} className="flex w-full max-w-xl gap-2">
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 outline-none focus:border-gray-500"
              type="text"
              placeholder="Search YouTube (e.g. lo-fi beats)"
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
            <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              Search for a video to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelected(v.id)}
                  className={`group overflow-hidden rounded-md border text-left hover:shadow-md ${
                    selected === v.id ? "border-gray-800" : "border-gray-200"
                  }`}
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
