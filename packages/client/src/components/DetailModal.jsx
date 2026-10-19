import { useEffect, useMemo, useRef, useState } from "react";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function MetaItem({ label, value }) {
  if (!value) return null;
  return (
    <div className="detail-meta-item">
      <span className="detail-meta-label">{label}</span>
      <span className="detail-meta-value">{value}</span>
    </div>
  );
}

export default function DetailModal({ modal, onClose, onPlay, suppressEscape = false, resumeInfo = null }) {
  const { item, detail, state } = modal;
  const closeRef = useRef(null);
  const restoreRef = useRef(null);
  const containerRef = useRef(null);
  const [selectedSeason, setSelectedSeason] = useState(null);

  useEffect(() => {
    const container = containerRef.current;
    restoreRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        if (suppressEscape) return;
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab" || !container) return;
      const focusables = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      restoreRef.current?.focus?.();
    };
  }, [onClose, suppressEscape]);

  const seasons = useMemo(() => {
    if (!detail?.episodes || detail.episodes.length === 0) return [];
    const map = new Map();
    for (const ep of detail.episodes) {
      const list = map.get(ep.season) ?? [];
      list.push(ep);
      map.set(ep.season, list);
    }
    return Array.from(map.entries())
      .map(([season, episodes]) => ({ season, episodes }))
      .sort((a, b) => a.season - b.season);
  }, [detail]);

  useEffect(() => {
    if (seasons.length === 0) {
      setSelectedSeason(null);
      return;
    }
    setSelectedSeason((prev) => (prev != null && seasons.some((s) => s.season === prev) ? prev : seasons[0].season));
  }, [seasons]);

  const backdrop = detail?.backdrop ?? item.backdrop ?? detail?.poster ?? item.poster;
  const poster = detail?.poster ?? item.poster;
  const title = detail?.title ?? item.title;
  const year = detail?.year ?? item.year;
  const rating = detail?.rating ?? item.rating;
  const genres = detail?.genres ?? item.genres;
  const overview = detail?.overview ?? item.overview;
  const runtime = detail?.runtime ?? null;
  const country = detail?.country ?? null;
  const language = detail?.language ?? null;
  const cast = detail?.cast ?? null;
  const director = detail?.director ?? null;
  const writer = detail?.writer ?? null;
  const awards = detail?.awards ?? null;
  const isSeries = (detail?.type ?? item.type) === "series";
  const activeSeason = seasons.find((s) => s.season === selectedSeason) ?? null;
  const episodeCount = detail?.episodes?.length ?? 0;

  return (
    <div
      className="modal-overlay"
      ref={containerRef}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close details">
          ×
        </button>

        <div className="modal-hero">
          {backdrop && <div className="modal-hero-bg" style={{ backgroundImage: `url(${backdrop})` }} />}
          <div className="modal-hero-shade" />
          <div className="modal-hero-content">
            {poster && (
              <img
                className="modal-poster"
                src={poster}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            )}
            <div className="modal-hero-text">
              <h2 id="modal-title">{title}</h2>
              <div className="modal-badges">
                {year && <span className="badge">{year}</span>}
                {rating && <span className="badge badge-rating">★ {rating}</span>}
                {runtime && <span className="badge">{runtime}</span>}
                {isSeries && episodeCount > 0 && <span className="badge">{episodeCount} episodes</span>}
                {genres?.slice(0, 3).map((genre) => (
                  <span className="badge badge-genre" key={genre}>
                    {genre}
                  </span>
                ))}
              </div>
              {state === "done" && (
                <div className="modal-actions">
                  <button
                    className="btn btn-play"
                    onClick={() => onPlay?.(item)}
                    title={resumeInfo ? `Resume from ${Math.floor(resumeInfo.position / 60)}m` : "Play"}
                  >
                    {resumeInfo ? "Resume" : "Play"}
                  </button>
                  {resumeInfo && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => onPlay?.({ ...item, restart: true })}
                    >
                      Start over
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-body">
          {state === "loading" && (
            <div className="detail-loading">
              <div className="player-spinner" aria-hidden="true" />
              <p className="muted">Loading details…</p>
            </div>
          )}

          {state === "error" && (
            <p className="err">Could not load details from the provider. You can still try playing this title.</p>
          )}

          {state === "done" && (
            <>
              {overview && <p className="modal-overview">{overview}</p>}

              <div className="detail-meta-grid">
                <MetaItem label="Type" value={isSeries ? "Series" : "Movie"} />
                <MetaItem label="Released" value={detail?.released ? String(detail.released).slice(0, 10) : year ? String(year) : null} />
                <MetaItem label="Runtime" value={runtime} />
                <MetaItem label="Country" value={country} />
                <MetaItem label="Language" value={language} />
                <MetaItem label="Rating" value={rating ? `★ ${rating}` : null} />
                <MetaItem label="Director" value={director?.length ? director.join(", ") : null} />
                <MetaItem label="Writer" value={writer?.length ? writer.join(", ") : null} />
                <MetaItem label="Cast" value={cast?.length ? cast.join(", ") : null} />
                <MetaItem label="Awards" value={awards} />
              </div>

              {isSeries && (
                <section className="episodes">
                  {seasons.length > 0 ? (
                    <>
                      <div className="episodes-header">
                        {seasons.length > 1 ? (
                          <label className="season-select">
                            <span>Season</span>
                            <select value={selectedSeason ?? ""} onChange={(e) => setSelectedSeason(Number(e.target.value))}>
                              {seasons.map((s) => (
                                <option key={s.season} value={s.season}>
                                  Season {s.season} ({s.episodes.length})
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <h3>Season {seasons[0].season}</h3>
                        )}
                        <span className="muted">{activeSeason?.episodes.length ?? 0} episodes</span>
                      </div>
                      <ul className="episode-grid">
                        {activeSeason?.episodes.map((ep) => (
                          <li key={ep.id ?? `${ep.season}-${ep.episode}`}>
                            <button
                              type="button"
                              className="episode-card"
                              onClick={() =>
                                onPlay?.({
                                  ...item,
                                  season: ep.season,
                                  episode: ep.episode,
                                  episodeTitle: ep.name ?? null,
                                  poster: ep.thumbnail ?? item.poster
                                })
                              }
                            >
                              <span className="episode-thumb">
                                {ep.thumbnail ? (
                                  <img
                                    src={ep.thumbnail}
                                    alt=""
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.visibility = "hidden";
                                    }}
                                  />
                                ) : (
                                  <span className="episode-thumb-fallback">{ep.episode}</span>
                                )}
                              </span>
                              <span className="episode-body">
                                <span className="episode-head">
                                  <span className="episode-num">E{ep.episode}</span>
                                  <span className="episode-name">{ep.name ?? `Episode ${ep.episode}`}</span>
                                </span>
                                <span className="episode-sub">
                                  {ep.firstAired ? String(ep.firstAired).slice(0, 10) : ""}
                                  {ep.rating ? ` · ★ ${ep.rating}` : ""}
                                  {!ep.firstAired && !ep.rating ? "Air date unavailable" : ""}
                                </span>
                                {ep.overview && <span className="episode-overview">{ep.overview}</span>}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="muted">Episode information is not available from the provider for this title.</p>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}