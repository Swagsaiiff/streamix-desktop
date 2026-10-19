import { useCallback, useEffect, useRef, useState } from "react";
import { progressStore } from "../lib/progress.js";
import { canScrollLeft, canScrollRight, nextScrollLeft, shouldShowArrows } from "../lib/carousel.js";

function formatRemaining(entry) {
  const remaining = Math.max(0, entry.duration - entry.position);
  const m = Math.floor(remaining / 60);
  const s = Math.floor(remaining % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m left`;
  }
  return `${m}:${String(s).padStart(2, "0")} left`;
}

export default function ContinueWatching({ entries, onResume, onStartOver, onDismiss }) {
  const scrollerRef = useRef(null);
  const [state, setState] = useState({ left: false, right: false, show: false });

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setState({
      left: canScrollLeft(el.scrollLeft),
      right: canScrollRight(el.scrollLeft, el.clientWidth, el.scrollWidth),
      show: shouldShowArrows(el.clientWidth, el.scrollWidth)
    });
  }, []);

  useEffect(() => {
    sync();
    const el = scrollerRef.current;
    if (!el) return undefined;
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [entries, sync]);

  const scrollBy = useCallback((direction) => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = nextScrollLeft({
      scrollLeft: el.scrollLeft,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      direction
    });
    el.scrollTo({ left: target, behavior: "smooth" });
  }, []);

  if (!entries || entries.length === 0) return null;

  return (
    <section className="row continue-row">
      <div className="row-header">
        <h2>Continue Watching</h2>
      </div>
      <div className="row-wrap">
        {state.show && (
          <button
            type="button"
            className={`row-arrow row-arrow-left${state.left ? "" : " is-disabled"}`}
            onClick={() => scrollBy("left")}
            disabled={!state.left}
            aria-label="Scroll Continue Watching left"
          >
            ‹
          </button>
        )}
        <div className="row-scroll" ref={scrollerRef}>
          {entries.map((entry) => {
            const percent = entry.duration > 0 ? Math.min(100, Math.round((entry.position / entry.duration) * 100)) : 0;
            return (
              <article className="continue-card" key={entry.key}>
                <button
                  type="button"
                  className="continue-poster"
                  onClick={() => onResume?.(entry)}
                  aria-label={`Resume ${entry.title ?? "title"}`}
                >
                  {entry.poster ? (
                    <img
                      src={entry.poster}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  ) : (
                    <span className="card-placeholder">{entry.title}</span>
                  )}
                  <span className="card-progress" aria-hidden="true">
                    <span className="card-progress-fill" style={{ width: `${percent}%` }} />
                  </span>
                </button>
                <span className="continue-title">
                  {entry.title}
                  {entry.season != null && entry.episode != null ? ` · S${entry.season}E${entry.episode}` : ""}
                </span>
                <span className="continue-meta">{formatRemaining(entry)}</span>
                <div className="continue-actions">
                  <button type="button" className="link-btn" onClick={() => onResume?.(entry)}>
                    Resume
                  </button>
                  <button type="button" className="link-btn" onClick={() => onStartOver?.(entry)}>
                    Start over
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onDismiss?.(entry)}
                    aria-label={`Remove ${entry.title ?? "title"} from Continue Watching`}
                  >
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {state.show && (
          <button
            type="button"
            className={`row-arrow row-arrow-right${state.right ? "" : " is-disabled"}`}
            onClick={() => scrollBy("right")}
            disabled={!state.right}
            aria-label="Scroll Continue Watching right"
          >
            ›
          </button>
        )}
      </div>
    </section>
  );
}