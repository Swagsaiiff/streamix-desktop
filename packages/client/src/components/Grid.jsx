import TitleCard from "./TitleCard.jsx";

export default function Grid({ items, onSelect }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="grid">
      {items.map((item) => (
        <TitleCard key={`${item.provider ?? "default"}:${item.type}:${item.id}`} item={item} onClick={onSelect} />
      ))}
    </div>
  );
}