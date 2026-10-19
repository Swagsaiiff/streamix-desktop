import { useCallback, useEffect, useRef, useState } from "react";
import TitleCard from "./TitleCard.jsx";
import { canScrollLeft, canScrollRight, nextScrollLeft, shouldShowArrows } from "../lib/carousel.js";

export default function Row({ title, items, onSelect }) {
  const scrollerRef = useRef(null);
  const [state, setState] = useState({ left: false, right: false, show: false });
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0, moved: false });

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
  }, [items, sync]);

  const scrollBy = useCallback(
    (direction) => {
      const el = scrollerRef.current;
      if (!el) return;
      const target = nextScrollLeft({
        scrollLeft: el.scrollLeft,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        direction
      });
      el.scrollTo({ left: target, behavior: "smooth" });
    },
    []
  );

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollBy("left");
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollBy("right");
      }
    },
    [scrollBy]
  );

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === "touch") return;
    const el = scrollerRef.current;
    if (!el) return;
    dragRef.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  }, []);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    const el = scrollerRef.current;
    if (!drag.active || !el) return;
    const delta = e.clientX - drag.startX;
    if (Math.abs(delta) > 6) drag.moved = true;
    el.scrollLeft = drag.startScroll - delta;
  }, []);

  const endDrag = useCallback(() => {
    if (dragRef.current.active && dragRef.current.moved) {
      // suppress the click that follows a drag
      window.setTimeout(() => {
        dragRef.current.moved = false;
      }, 0);
    }
    dragRef.current.active = false;
  }, []);

  const handleSelect = useCallback(
    (item) => {
      if (dragRef.current.moved) return;
      onSelect?.(item);
    },
    [onSelect]
  );

  if (!items || items.length === 0) return null;

  return (
    <section className="row">
      <div className="row-header">
        <h2>{title}</h2>
      </div>
      <div className="row-wrap" onKeyDown={onKeyDown} tabIndex={0} role="region" aria-label={title}>
        {state.show && (
          <button
            type="button"
            className={`row-arrow row-arrow-left${state.left ? "" : " is-disabled"}`}
            onClick={() => scrollBy("left")}
            disabled={!state.left}
            aria-label={`Scroll ${title} left`}
          >
            ‹
          </button>
        )}
        <div
          className="row-scroll"
          ref={scrollerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          {items.map((item) => (
            <TitleCard key={`${item.provider ?? "default"}:${item.type}:${item.id}`} item={item} onClick={handleSelect} />
          ))}
        </div>
        {state.show && (
          <button
            type="button"
            className={`row-arrow row-arrow-right${state.right ? "" : " is-disabled"}`}
            onClick={() => scrollBy("right")}
            disabled={!state.right}
            aria-label={`Scroll ${title} right`}
          >
            ›
          </button>
        )}
      </div>
    </section>
  );
}