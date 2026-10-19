// Pure carousel helpers so the row arrows are testable without a DOM.

export function canScrollLeft(scrollLeft, threshold = 4) {
  return scrollLeft > threshold;
}

export function canScrollRight(scrollLeft, clientWidth, scrollWidth, threshold = 4) {
  return scrollLeft + clientWidth < scrollWidth - threshold;
}

export function nextScrollLeft({ scrollLeft, clientWidth, scrollWidth, direction, cardsPerView = 3 }) {
  const page = Math.max(180, clientWidth - 48);
  const step = page;
  if (direction === "left") {
    return Math.max(0, scrollLeft - step);
  }
  const max = Math.max(0, scrollWidth - clientWidth);
  return Math.min(max, scrollLeft + step);
}

export function shouldShowArrows(clientWidth, scrollWidth, threshold = 8) {
  return scrollWidth - clientWidth > threshold;
}