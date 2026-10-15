// Blocks further down a page play the page-load entrance (the 12 px rise, lists one item after
// another) the first time they scroll into view, instead of animating unseen on load.
// Blocks already on screen at load keep the normal load animation. Without IntersectionObserver,
// or under reduced motion, nothing waits: everything is simply there.
import { prefersReducedMotion } from "./motion.js";

export function revealOnScroll(blocks) {
  if (prefersReducedMotion() || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.replace("is-waiting", "is-entering");
      io.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -12% 0px" });                    // once its top is a little way up the screen
  for (const block of blocks) {
    if (block.getBoundingClientRect().top < window.innerHeight) continue;
    block.classList.add("is-waiting");
    io.observe(block);
  }
}
