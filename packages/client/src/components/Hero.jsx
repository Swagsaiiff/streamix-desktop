export default function Hero({ item, onMoreInfo, onPlay }) {
  if (!item) return null;
  const backdrop = item.backdrop ?? item.poster;
  return (
    <section className="hero" aria-label="Featured content">
      {backdrop && <div className="hero-bg" style={{ backgroundImage: `url(${backdrop})` }} />}
      <div className="hero-overlay" />
      <div className="hero-content">
        <h1 className="hero-title">{item.title}</h1>
        <div className="hero-meta">
          {item.year && <span>{item.year}</span>}
          {item.rating && <span>★ {item.rating}</span>}
          {item.type && <span>{item.type}</span>}
          {item.genres?.[0] && <span>{item.genres[0]}</span>}
        </div>
        {item.overview && <p className="hero-overview">{item.overview}</p>}
        <div className="hero-actions">
          <button className="btn btn-play" disabled={!onPlay} onClick={() => onPlay?.(item)}>
            Play
          </button>
          <button className="btn btn-more" onClick={() => onMoreInfo(item)}>
            More Info
          </button>
        </div>
      </div>
      <div className="hero-fade" />
    </section>
  );
}
