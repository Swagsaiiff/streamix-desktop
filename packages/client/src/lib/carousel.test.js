import test from "node:test";
import assert from "node:assert/strict";
import { canScrollLeft, canScrollRight, nextScrollLeft, shouldShowArrows } from "./carousel.js";

test("canScrollLeft is false at the start and true after scrolling", () => {
  assert.equal(canScrollLeft(0), false);
  assert.equal(canScrollLeft(120), true);
});

test("canScrollRight is false at the end and true when content remains", () => {
  assert.equal(canScrollRight(0, 800, 2000), true);
  assert.equal(canScrollRight(1200, 800, 2000), false);
});

test("shouldShowArrows hides arrows when everything fits", () => {
  assert.equal(shouldShowArrows(900, 880), false);
  assert.equal(shouldShowArrows(600, 2000), true);
});

test("nextScrollLeft scrolls by about one viewport and clamps at both ends", () => {
  const right = nextScrollLeft({ scrollLeft: 0, clientWidth: 800, scrollWidth: 2400, direction: "right" });
  assert.equal(right, 752);
  const clampedRight = nextScrollLeft({ scrollLeft: 1900, clientWidth: 800, scrollWidth: 2400, direction: "right" });
  assert.equal(clampedRight, 1600);
  const clampedLeft = nextScrollLeft({ scrollLeft: 100, clientWidth: 800, scrollWidth: 2400, direction: "left" });
  assert.equal(clampedLeft, 0);
  const left = nextScrollLeft({ scrollLeft: 1200, clientWidth: 800, scrollWidth: 2400, direction: "left" });
  assert.equal(left, 448);
});

test("nextScrollLeft never returns a negative offset", () => {
  assert.equal(nextScrollLeft({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400, direction: "right" }), 0);
});