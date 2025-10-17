"use client";

import React from "react";

// YouTube IFrame API type declarations
declare global {
    interface Window {
        YT: {
            Player: new (
                elementId: string,
                config: {
                    videoId: string;
                    playerVars?: {
                        rel?: number;
                        modestbranding?: number;
                    };
                    events?: {
                        onReady?: (event: { target: YT.Player }) => void;
                        onStateChange?: (event: { target: YT.Player; data: number }) => void;
                    };
                }
            ) => YT.Player;
            PlayerState: {
                UNSTARTED: -1;
                ENDED: 0;
                PLAYING: 1;
                PAUSED: 2;
                BUFFERING: 3;
                CUED: 5;
            };
        };
        onYouTubeIframeAPIReady: () => void;
    }
}

namespace YT {
    export interface Player {
        destroy(): void;
        loadVideoById(videoId: string): void;
        pauseVideo(): void;
        getCurrentTime(): number;
        getDuration(): number;
    }
}

// Daily watch time limit (localStorage-backed)
const MAX_DAILY_SECONDS = 2700; // 45 minutes
const STORAGE_KEY = "ft.dailyWatchTime";

// Daily video limit (localStorage-backed)
const MAX_DAILY_VIDEOS = 4;
const VIDEO_STORAGE_KEY = "ft.dailyVideoCount";

type WatchTimeCounter = {
    date: string;
    totalSeconds: number;
};

type VideoCountCounter = {
    date: string;
    totalVideos: number;
};

function todayKey() {
    // Local-day key so it resets per local calendar day
    return new Date().toDateString();
}

function readWatchTime(): WatchTimeCounter {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const today = todayKey();
        if (!raw) return { date: today, totalSeconds: 0 };
        const parsed = JSON.parse(raw) as WatchTimeCounter;
        if (!parsed?.date || parsed.date !== today) {
            return { date: today, totalSeconds: 0 };
        }
        return { date: parsed.date, totalSeconds: Number(parsed.totalSeconds) || 0 };
    } catch {
        return { date: todayKey(), totalSeconds: 0 };
    }
}

function writeWatchTime(counter: WatchTimeCounter) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(counter));
    } catch {
        // no-op
    }
}

function readVideoCount(): VideoCountCounter {
    try {
        const raw = localStorage.getItem(VIDEO_STORAGE_KEY);
        const today = todayKey();
        if (!raw) return { date: today, totalVideos: 0 };
        const parsed = JSON.parse(raw) as VideoCountCounter;
        if (!parsed?.date || parsed.date !== today) {
            return { date: today, totalVideos: 0 };
        }
        return { date: parsed.date, totalVideos: Number(parsed.totalVideos) || 0 };
    } catch {
        return { date: todayKey(), totalVideos: 0 };
    }
}

function writeVideoCount(counter: VideoCountCounter) {
    try {
        localStorage.setItem(VIDEO_STORAGE_KEY, JSON.stringify(counter));
    } catch {
        // no-op
    }
}

function useDailyWatchTime(maxSeconds: number) {
    const [totalSeconds, setTotalSeconds] = React.useState(0);
    const [ready, setReady] = React.useState(false);
    const [isTracking, setIsTracking] = React.useState(false);
    const intervalRef = React.useRef<NodeJS.Timeout | null>(null);
    const trackingStartTime = React.useRef<number>(0);
    const baseSeconds = React.useRef<number>(0);

    // Load initial time on mount
    React.useEffect(() => {
        const data = readWatchTime();
        setTotalSeconds(data.totalSeconds);
        setReady(true);
    }, []);

    // Start tracking time - use wall-clock time to handle background tabs
    const startTracking = React.useCallback(() => {
        if (isTracking) return;
        trackingStartTime.current = Date.now();
        baseSeconds.current = totalSeconds;
        setIsTracking(true);
    }, [isTracking, totalSeconds]);

    // Stop tracking time - calculate final elapsed time
    const stopTracking = React.useCallback(() => {
        if (!isTracking) return;

        // Calculate actual elapsed time based on wall-clock
        const elapsed = Math.floor((Date.now() - trackingStartTime.current) / 1000);
        const finalSeconds = Math.min(maxSeconds, baseSeconds.current + elapsed);

        setTotalSeconds(finalSeconds);
        writeWatchTime({ date: todayKey(), totalSeconds: finalSeconds });
        setIsTracking(false);

        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, [isTracking, maxSeconds]);

    // Wall-clock based time tracking (works even when tab is in background)
    React.useEffect(() => {
        if (isTracking) {
            // Update display every second
            intervalRef.current = setInterval(() => {
                const elapsed = Math.floor((Date.now() - trackingStartTime.current) / 1000);
                const newTotal = Math.min(maxSeconds, baseSeconds.current + elapsed);
                setTotalSeconds(newTotal);

                // Persist every 5 seconds to reduce I/O
                if (newTotal % 5 === 0 || newTotal >= maxSeconds) {
                    writeWatchTime({ date: todayKey(), totalSeconds: newTotal });
                }
            }, 1000);
        } else if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [isTracking, maxSeconds]);

    const remainingSeconds = Math.max(0, maxSeconds - totalSeconds);
    const canPlay = ready && remainingSeconds > 0;

    return { totalSeconds, remainingSeconds, canPlay, startTracking, stopTracking, ready, isTracking } as const;
}

function useDailyVideoCount(maxVideos: number) {
    const [totalVideos, setTotalVideos] = React.useState(0);
    const [ready, setReady] = React.useState(false);

    // Load initial count on mount
    React.useEffect(() => {
        const data = readVideoCount();
        setTotalVideos(data.totalVideos);
        setReady(true);
    }, []);

    const incrementVideoCount = React.useCallback(() => {
        const newTotal = totalVideos + 1;
        setTotalVideos(newTotal);
        writeVideoCount({ date: todayKey(), totalVideos: newTotal });
    }, [totalVideos]);

    const remainingVideos = Math.max(0, maxVideos - totalVideos);
    const canPlayVideo = ready && remainingVideos > 0;

    return { totalVideos, remainingVideos, canPlayVideo, incrementVideoCount, ready } as const;
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

// Format seconds to minutes display (e.g., "45m" or "1h 15m")
function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export default function App() {
    const watchTime = useDailyWatchTime(MAX_DAILY_SECONDS);
    const videoCount = useDailyVideoCount(MAX_DAILY_VIDEOS);
    const [query, setQuery] = React.useState("");
    const [results, setResults] = React.useState<YTItem[]>([]);
    const [selected, setSelected] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [pageTokens, setPageTokens] = React.useState<{
        next: string | null;
        prev: string | null;
    }>({ next: null, prev: null });
    const [ytReady, setYtReady] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const [isPaused, setIsPaused] = React.useState(false);
    const playerRef = React.useRef<YT.Player | null>(null);
    const playerContainerRef = React.useRef<HTMLDivElement>(null);
    const endCheckIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
    const lastPlayedVideoRef = React.useRef<string | null>(null);

    // Combined canPlay checks both time and video limits
    const canPlay = watchTime.canPlay && videoCount.canPlayVideo;

    // Load YouTube IFrame API
    React.useEffect(() => {
        // Check if API already loaded
        if (window.YT && window.YT.Player) {
            setYtReady(true);
            return;
        }

        // Set up callback
        window.onYouTubeIframeAPIReady = () => {
            setYtReady(true);
        };

        // Load the script
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName("script")[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }, []);

    // Initialize/update YouTube Player when video changes
    React.useEffect(() => {
        if (!ytReady || !selected || !playerContainerRef.current) return;

        // Destroy existing player
        if (playerRef.current) {
            playerRef.current.destroy();
            playerRef.current = null;
        }

        // Reset pause state when changing videos
        setIsPaused(false);
        // Reset last played video for counting
        lastPlayedVideoRef.current = null;

        // Create new player
        playerRef.current = new window.YT.Player("yt-player", {
            videoId: selected,
            playerVars: {
                rel: 0, // Only show related videos from same channel
                modestbranding: 1, // Minimize YouTube branding
            },
            events: {
                onReady: () => {
                    // Start interval to check if video is near end
                    endCheckIntervalRef.current = setInterval(() => {
                        if (!playerRef.current) return;

                        const currentTime = playerRef.current.getCurrentTime();
                        const duration = playerRef.current.getDuration();

                        // Pause at the very last moment (0.5s before end) to prevent end screen
                        if (duration > 0 && currentTime >= duration - 0.5) {
                            playerRef.current.pauseVideo();
                        }
                    }, 500); // Check every 500ms
                },
                onStateChange: (event) => {
                    const state = event.data;
                    if (state === window.YT.PlayerState.PLAYING) {
                        // Check if any limit already reached before starting
                        if (!canPlay) {
                            // Immediately stop and unload video
                            if (playerRef.current) {
                                playerRef.current.destroy();
                                playerRef.current = null;
                            }
                            setSelected(null);
                            const timeLimitReached = !watchTime.canPlay;
                            const videoLimitReached = !videoCount.canPlayVideo;
                            const errorMsg = timeLimitReached
                                ? "Daily watch time limit reached (45 minutes). Try again tomorrow."
                                : "Daily video limit reached (4 videos). Try again tomorrow.";
                            setError(errorMsg);
                            return;
                        }
                        // Increment video count if this is the first play for this video
                        if (selected && selected !== lastPlayedVideoRef.current) {
                            videoCount.incrementVideoCount();
                            lastPlayedVideoRef.current = selected;
                        }
                        // Start tracking time when video plays
                        watchTime.startTracking();
                        setIsPaused(false);
                    } else if (
                        state === window.YT.PlayerState.PAUSED ||
                        state === window.YT.PlayerState.ENDED
                    ) {
                        // Stop tracking time when video pauses or ends
                        watchTime.stopTracking();
                        setIsPaused(true);
                    }
                },
            },
        });

        return () => {
            if (playerRef.current) {
                playerRef.current.destroy();
                playerRef.current = null;
            }
            if (endCheckIntervalRef.current) {
                clearInterval(endCheckIntervalRef.current);
                endCheckIntervalRef.current = null;
            }
        };
        // Only recreate player when video ID or API readiness changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ytReady, selected]);

    // Auto-stop and unload video when any limit is reached during playback
    React.useEffect(() => {
        if (!canPlay && watchTime.isTracking) {
            // Stop tracking immediately
            watchTime.stopTracking();

            // Destroy player and unload video
            if (playerRef.current) {
                playerRef.current.destroy();
                playerRef.current = null;
            }
            setSelected(null);

            // Show error message
            const timeLimitReached = !watchTime.canPlay;
            const videoLimitReached = !videoCount.canPlayVideo;
            const errorMsg = timeLimitReached
                ? "Daily watch time limit reached (45 minutes). Try again tomorrow."
                : "Daily video limit reached (4 videos). Try again tomorrow.";
            setError(errorMsg);
        }
        // Only need the specific boolean values, not the entire canPlay and watchTime object
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canPlay, watchTime.isTracking]);

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
                // Only auto-select a video if the user still has limits left today
                if (watchTime.ready && videoCount.ready && canPlay) {
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
        // If the query is a YouTube URL, play it (respecting daily limits)
        const urlId = extractYouTubeVideoId(query);
        if (urlId) {
            setError(null);
            if (!canPlay) {
                const timeLimitReached = !watchTime.canPlay;
                const videoLimitReached = !videoCount.canPlayVideo;
                const errorMsg = timeLimitReached
                    ? "Daily watch time limit reached (45 minutes). Try again tomorrow."
                    : "Daily video limit reached (4 videos). Try again tomorrow.";
                setError(errorMsg);
                return;
            }
            setSelected(urlId);
            return;
        }

        // Fallback to normal search
        runSearch(query);
    }

    async function copyVideoUrl() {
        if (!selected) return;

        const url = `https://www.youtube.com/watch?v=${selected}`;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            // Reset after 2 seconds
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    }

    return (
        <div className="min-h-screen px-4 py-6">
            <div className="mx-auto max-w-5xl">
                <header className="mb-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
                    <h1 className="text-2xl font-semibold tracking-tight">FocusTube</h1>
                    <form onSubmit={onSubmit} className="flex w-full max-w-xl items-center gap-2">
                        {/* Daily limits badge */}
                        <div
                            className={`select-none rounded-md border px-2 py-1 text-xs font-medium ${!canPlay
                                    ? "border-red-300 bg-red-50 text-red-700"
                                    : watchTime.remainingSeconds < 300 || videoCount.remainingVideos <= 1
                                        ? "border-orange-300 bg-orange-50 text-orange-700"
                                        : "border-gray-300 bg-gray-50 text-gray-700"
                                }`}
                            title={`Time: ${formatTime(watchTime.totalSeconds)}/${formatTime(MAX_DAILY_SECONDS)}, Videos: ${videoCount.totalVideos}/${MAX_DAILY_VIDEOS}`}
                            aria-label={`Time used: ${formatTime(watchTime.totalSeconds)} of ${formatTime(MAX_DAILY_SECONDS)}, Videos watched: ${videoCount.totalVideos} of ${MAX_DAILY_VIDEOS}`}
                        >
                            {formatTime(watchTime.totalSeconds)}/{formatTime(MAX_DAILY_SECONDS)} • {videoCount.totalVideos}/{MAX_DAILY_VIDEOS}
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
                    <div className="mb-6">
                        <div
                            ref={playerContainerRef}
                            className="relative aspect-video w-full overflow-hidden rounded-md border border-gray-300"
                        >
                            <div id="yt-player" className="h-full w-full" />
                            {/* Black overlay to hide "More videos" bar when paused */}
                            {isPaused && (
                                <div
                                    className="absolute left-0 right-0 bg-black pointer-events-none"
                                    style={{ bottom: '48px', height: 'calc(35% - 48px)' }}
                                />
                            )}
                        </div>
                        <div className="mt-2 flex justify-end">
                            <button
                                onClick={copyVideoUrl}
                                className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                                title="Copy video URL"
                            >
                                <svg
                                    className="h-4 w-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    />
                                </svg>
                                {copied ? "Copied!" : "Copy URL"}
                            </button>
                        </div>
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
                                        if (!canPlay) {
                                            const timeLimitReached = !watchTime.canPlay;
                                            const videoLimitReached = !videoCount.canPlayVideo;
                                            const errorMsg = timeLimitReached
                                                ? "Daily watch time limit reached (45 minutes). Try again tomorrow."
                                                : "Daily video limit reached (4 videos). Try again tomorrow.";
                                            setError(errorMsg);
                                            return;
                                        }
                                        setSelected(v.id);
                                    }}
                                    disabled={!canPlay && selected !== v.id}
                                    className={`group overflow-hidden rounded-md border text-left hover:shadow-md ${selected === v.id ? "border-gray-800" : "border-gray-200"
                                        } ${!canPlay && selected !== v.id ? "opacity-60" : ""}`}
                                >
                                    <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
                                        {/* Use img to avoid Next image config */}
                                        {v.thumbnail ? (
                                            <>
                                                <img
                                                    src={v.thumbnail}
                                                    alt={v.title}
                                                    className={`h-full w-full object-cover transition-transform group-hover:scale-[1.02] ${selected !== v.id ? "grayscale" : ""}`}
                                                />
                                                <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-3 text-sm font-semibold text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                                                    <span className="line-clamp-2">{v.title}</span>
                                                </div>
                                            </>
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
