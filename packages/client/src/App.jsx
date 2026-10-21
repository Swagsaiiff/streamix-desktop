import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { fetchHomeSections, fetchSearch, fetchDetail } from "./api.js";
import Navbar from "./components/Navbar.jsx";
import Hero from "./components/Hero.jsx";
import Row from "./components/Row.jsx";
import Grid from "./components/Grid.jsx";
import SkeletonRow from "./components/SkeletonRow.jsx";
import DetailModal from "./components/DetailModal.jsx";
import Player from "./components/Player.jsx";
import ContinueWatching from "./components/ContinueWatching.jsx";
import Settings from "./components/Settings.jsx";
import { progressStore } from "./lib/progress.js";

export default function App() {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sectionErrors, setSectionErrors] = useState([]);
  const [view, setView] = useState("home");
  const [heroItem, setHeroItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searchState, setSearchState] = useState("idle");
  const [modal, setModal] = useState(null);
  const [player, setPlayer] = useState(null);
  const [continueEntries, setContinueEntries] = useState([]);
  const detailCacheRef = useRef(new Map());
  const searchControllerRef = useRef(null);
  const detailControllerRef = useRef(null);
  const latestQueryRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHomeSections()
      .then((rows) => {
        if (cancelled) return;
        const ok = Array.isArray(rows) ? rows.filter((row) => row?.data?.items?.length) : [];
        setSections(ok);
        setSectionErrors([]);
        const trending = ok.find((s) => s.data.key === "trending");
        const candidate =
          trending?.data.items.find((i) => i.backdrop) ?? trending?.data.items[0] ?? null;
        setHeroItem(candidate ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setSections([]);
        setSectionErrors([err.message]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshProgress = useCallback(() => {
    setContinueEntries(progressStore.list());
  }, []);

  useEffect(() => {
    refreshProgress();
  }, [refreshProgress]);

  const handleSearch = useCallback(
    async (q) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) return;
      setSearchQuery(trimmed);
      setView("search");
      setSearchState("loading");
      latestQueryRef.current = trimmed;
      if (searchControllerRef.current) {
        searchControllerRef.current.abort();
      }
      const controller = new AbortController();
      searchControllerRef.current = controller;
      try {
        const result = await fetchSearch(trimmed, { signal: controller.signal });
        if (latestQueryRef.current !== trimmed) return;
        setSearchResult(result);
        setSearchState("done");
      } catch (err) {
        if (err.name === "AbortError") return;
        if (latestQueryRef.current !== trimmed) return;
        setSearchState("error");
      }
    },
    [searchControllerRef]
  );

  const resetSearchState = useCallback(() => {
    if (searchControllerRef.current) {
      searchControllerRef.current.abort();
    }
    latestQueryRef.current = null;
    setSearchQuery("");
    setSearchResult(null);
    setSearchState("idle");
  }, []);

  const clearSearch = useCallback(() => {
    resetSearchState();
    setView("home");
  }, [resetSearchState]);

  const openDetail = useCallback(
    async (item) => {
      const key = `${item.provider ?? "default"}:${item.type}:${item.id}`;
      const cached = detailCacheRef.current.get(key);
      if (cached) {
        setModal({ item, detail: cached, state: "done" });
        return;
      }
      if (detailControllerRef.current) {
        detailControllerRef.current.abort();
      }
      const controller = new AbortController();
      detailControllerRef.current = controller;
      setModal({ item, detail: null, state: "loading" });
      try {
        const data = await fetchDetail(item.type, item.id, {
          signal: controller.signal,
          provider: item.provider
        });
        detailCacheRef.current.set(key, data.item);
        setModal({ item, detail: data.item, state: "done" });
      } catch (err) {
        if (err.name === "AbortError") return;
        setModal({ item, detail: null, state: "error" });
      }
    },
    [detailCacheRef, detailControllerRef]
  );

  const closeModal = useCallback(() => {
    if (detailControllerRef.current) {
      detailControllerRef.current.abort();
    }
    setModal(null);
  }, [detailControllerRef]);

  const openPlayer = useCallback((item) => {
    setPlayer({ ...item });
  }, []);

  const closePlayer = useCallback(() => {
    setPlayer(null);
    refreshProgress();
  }, [refreshProgress]);

  const resumeEntry = useCallback((entry) => {
    setPlayer({
      provider: entry.provider,
      type: entry.type,
      id: entry.id,
      title: entry.title,
      poster: entry.poster,
      backdrop: entry.backdrop,
      season: entry.season ?? null,
      episode: entry.episode ?? null,
      episodeTitle: entry.episodeTitle ?? null
    });
  }, []);

  const startOverEntry = useCallback(
    (entry) => {
      progressStore.remove(entry);
      refreshProgress();
      setPlayer({
        provider: entry.provider,
        type: entry.type,
        id: entry.id,
        title: entry.title,
        poster: entry.poster,
        backdrop: entry.backdrop,
        season: entry.season ?? null,
        episode: entry.episode ?? null,
        episodeTitle: entry.episodeTitle ?? null,
        restart: true
      });
    },
    [refreshProgress]
  );

  const dismissEntry = useCallback(
    (entry) => {
      progressStore.remove(entry);
      refreshProgress();
    },
    [refreshProgress]
  );

  const resumeFor = useCallback((item) => {
    const provider = item.provider ?? "default";
    const direct = progressStore.get({
      provider,
      type: item.type,
      id: item.id,
      season: item.season ?? null,
      episode: item.episode ?? null
    });
    if (direct) return direct;
    if (item.type === "series") {
      return progressStore.list().find((entry) => entry.type === "series" && entry.id === item.id && (entry.provider ?? "default") === provider) ?? null;
    }
    return null;
  }, []);

  const visibleItems = useMemo(() => {
    if (view === "home") return [];
    const all = sections.flatMap((s) => s.data.items);
    if (view === "movies") return all.filter((i) => i.type === "movie");
    if (view === "series") return all.filter((i) => i.type === "series");
    return all;
  }, [sections, view]);

  const dedupedItems = useMemo(() => {
    const map = new Map();
    for (const item of visibleItems) {
      if (item.id && !map.has(item.id)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }, [visibleItems]);

  const handleNavigate = useCallback((v) => {
    resetSearchState();
    setView(v);
  }, [resetSearchState]);

  return (
    <main className="app">
      <Navbar
        view={view}
        onNavigate={handleNavigate}
        onSearch={handleSearch}
        onSelectSuggestion={(item) => openDetail(item)}
        searchState={searchState}
      />

      {view === "settings" ? (
        <Settings />
      ) : searchState !== "idle" && view === "search" ? (
        <section className="search-results">
          <div className="row-header">
            <h2>Results for "{searchQuery}"</h2>
            <button className="link-btn" onClick={clearSearch}>
              Clear
            </button>
          </div>
          {searchState === "loading" && <SkeletonRow count={8} />}
          {searchState === "error" && (
            <p className="err">Search failed. The provider may be unreachable.</p>
          )}
          {searchState === "done" && searchResult?.count === 0 && (
            <p className="muted">No results found.</p>
          )}
          {searchState === "done" && searchResult?.count > 0 && (
            <Grid items={searchResult.items} onSelect={openDetail} />
          )}
        </section>
      ) : (
        <>
          {loading && (
            <>
              <SkeletonRow count={6} />
              <SkeletonRow count={6} />
              <SkeletonRow count={6} />
            </>
          )}
          {sectionErrors.length > 0 && (
            <p className="err">Some sections failed to load: {sectionErrors.join("; ")}</p>
          )}
          {!loading && sections.length === 0 && (
            <div style={{ textAlign: "center", padding: "4rem 1.5rem" }}>
              <p className={error ? "err" : "muted"}>
                {error || "No sections loaded. Check that the server is running."}
              </p>
            </div>
          )}

          {(view === "home" || view === "movies" || view === "series") && (
            <>
              {view === "home" && heroItem && (
                <Hero item={heroItem} onMoreInfo={openDetail} onPlay={openPlayer} />
              )}
              {view === "home" && continueEntries.length > 0 && (
                <ContinueWatching
                  entries={continueEntries}
                  onResume={resumeEntry}
                  onStartOver={startOverEntry}
                  onDismiss={dismissEntry}
                />
              )}
              {view === "home" &&
                sections.map(({ key, data }) => (
                  <Row
                    key={key}
                    title={data.title}
                    items={data.items}
                    onSelect={openDetail}
                  />
                ))}
              {(view === "movies" || view === "series") && (
                <Row
                  title={view === "movies" ? "Movies" : "Series"}
                  items={dedupedItems}
                  onSelect={openDetail}
                />
              )}
            </>
          )}
        </>
      )}

      {modal && (
        <DetailModal
          modal={modal}
          onClose={closeModal}
          onPlay={(playedItem) => {
            const detailResume = resumeFor({ ...modal.item, season: null, episode: null });
            const isSeriesPlay = (modal.detail?.type ?? modal.item.type) === "series";
            const resumeTarget = playedItem.season == null && isSeriesPlay ? detailResume : null;
            openPlayer({
              ...playedItem,
              season: playedItem.season ?? resumeTarget?.season ?? null,
              episode: playedItem.episode ?? resumeTarget?.episode ?? null,
              episodeTitle: playedItem.episodeTitle ?? resumeTarget?.episodeTitle ?? null,
              episodes: playedItem.episodes ?? modal.detail?.episodes ?? null,
              runtime: modal.detail?.runtime ?? playedItem.runtime ?? null
            });
          }}
          resumeInfo={resumeFor({ ...modal.item, season: null, episode: null })}
          suppressEscape={Boolean(player)}
        />
      )}
      {player && <Player item={player} onClose={closePlayer} onProgress={refreshProgress} />}

      <footer className="app-footer" role="contentinfo">
        <div className="tmdb-attribution">
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noopener noreferrer"
            className="tmdb-logo-link"
            aria-label="The Movie Database (TMDB)"
          >
            <svg
              className="tmdb-logo"
              viewBox="0 0 185 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              height="16"
              aria-hidden="true"
            >
              <path
                d="M7.74 0H0v3.08h2.32v10.74h3.1V3.08h2.32V0zm17.9 0l-3.3 8.35L19.04 0h-3.95v13.82h2.95V4.65l2.97 7.22h2.64l2.97-7.22v9.17h2.95V0h-3.93zm16.89 0h-7.07v13.82h6.8c3.95 0 6.44-2.22 6.44-6.91 0-4.69-2.49-6.91-6.17-6.91zm-.43 10.74h-3.54V3.08h3.54c2.25 0 3.32 1.35 3.32 3.83 0 2.48-1.07 3.83-3.32 3.83zm22.42-4.73c2.08-.47 3.25-1.74 3.25-3.66C67.77 0 65.65 0 62.46 0h-6.73v13.82h7.32c3.48 0 5.83-.34 5.83-3.83 0-1.89-1.31-3.26-4.36-3.98zm-3.8-2.93h-3.08V2.73h3.08c1.37 0 2.22.47 2.22 1.54 0 1.07-.85 1.54-2.22 1.54zm.64 7.66h-3.72V7.93h3.72c1.47 0 2.37.52 2.37 1.63 0 1.11-.9 1.63-2.37 1.63z"
                fill="#01B4E4"
              />
            </svg>
          </a>
          <p className="tmdb-notice">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>
      </footer>
    </main>
  );
}

