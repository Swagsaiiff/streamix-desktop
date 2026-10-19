export default function TitleCard({ item, onClick, progress = null }) {
  const poster = item.enriched?.poster ?? item.poster;
  const percent = progress && progress.duration > 0 ? Math.min(100, Math.round((progress.position / progress.duration) * 100)) : 0;
  return (
    <button
      type="button"
      className="card"
      onClick={() => onClick?.(item)}
      aria-label={`${item.title} (${item.type}) details`}
      data-provider={item.provider ?? ""}
    >
      <span className="card-poster">
        <span className="card-placeholder">{item.title}</span>
        {poster && (
          <img
            src={poster}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        {percent > 0 && (
          <span className="card-progress" aria-hidden="true">
            <span className="card-progress-fill" style={{ width: `${percent}%` }} />
          </span>
        )}
        <span className="card-overlay">
          <span className="card-title-overlay">{item.title}</span>
          <span className="card-meta-overlay">
            {item.year ? `${item.year} ` : ""}
            {item.rating ? `★ ${item.rating}` : ""}
          </span>
        </span>
      </span>
      <span className="card-title">{item.title}</span>
      <span className="card-meta">
        {item.type}
        {item.year ? ` · ${item.year}` : ""}
        {item.rating ? ` · ${item.rating}` : ""}
      </span>
      {item.provider && item.provider !== "CineStream" && (
        <span className="card-provider">{item.provider}</span>
      )}
    </button>
  );
}