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

  const clearSearch = useCallback(() => {
    if (searchControllerRef.current) {
      searchControllerRef.current.abort();
    }
    latestQueryRef.current = null;
    setSearchQuery("");
    setSearchResult(null);
    setSearchState("idle");
    setView("home");
  }, []);

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
    setView(v);
    if (v === "home") {
      clearSearch();
    }
  }, [clearSearch]);

  return (
    <main className="app">
      <Navbar
        view={view}
        onNavigate={handleNavigate}
        onSearch={handleSearch}
        searchState={searchState}
      />

      {searchState !== "idle" && view === "search" ? (
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
            <p className="muted">No sections loaded. Check that the server is running.</p>
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
    </main>
  );
}
