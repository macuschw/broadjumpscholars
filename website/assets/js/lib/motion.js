// Reduced-motion awareness: every animation in the site checks this first.
const query = window.matchMedia("(prefers-reduced-motion: reduce)");
export const prefersReducedMotion = () => query.matches;
export const onMotionPreferenceChange = (fn) => query.addEventListener("change", () => fn(query.matches));

/** Promise-based wait that resolves immediately when motion is reduced. */
export const wait = (ms) => new Promise((r) => setTimeout(r, prefersReducedMotion() ? 0 : ms));
