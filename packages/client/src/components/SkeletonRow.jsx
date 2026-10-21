export default function SkeletonRow({ count = 8 }) {
  return (
    <section className="row" aria-hidden="true">
      <div className="skeleton skeleton-title" />
      <div className="row-scroll">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skeleton skeleton-card" />
        ))}
      </div>
    </section>
  );
}
