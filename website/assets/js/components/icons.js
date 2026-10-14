// Inline SVG icons (stroke style, 24x24 grid). Decorative unless given a label.
const paths = {
  record: '<rect x="3" y="7" width="13" height="10" rx="1.5"/><path d="m16 11 5-3v8l-5-3"/><path d="M9.5 17v4M6 21h7"/>',
  track: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v6m0 0-4 7m4-7 4 7M7 10l5-1 5 1"/>',
  calculate: '<path d="M4 20c3-9 7-14 16-16"/><circle cx="4" cy="20" r="1.6"/><path d="M14 20h6M17 17v6"/>',
  improve: '<path d="M4 20V10M10 20V6M16 20v-8M3 20h18"/><path d="m14 5 3-2 3 2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  upload: '<path d="M12 16V4m0 0-5 5m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  play: '<path d="M7 5v14l12-7Z"/>',
  pause: '<path d="M7 5v14M17 5v14"/>',
  stepBack: '<path d="M6 5v14M18 6l-9 6 9 6Z"/>',
  stepFwd: '<path d="M18 5v14M6 6l9 6-9 6Z"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
  rotateLeft: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
  rotateRight: '<path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.6"/><path d="M20 4v4.6h-4.6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  coach: '<circle cx="12" cy="7" r="3"/><path d="M5 20c1-4 3.5-6 7-6s6 2 7 6"/><path d="M17 4.5h3"/>',
  facility: '<path d="M3 20V9l9-5 9 5v11"/><path d="M8 20v-6h8v6"/>',
  clinic: '<path d="M12 4v16M4 12h16"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
  athlete: '<circle cx="15" cy="4.5" r="2"/><path d="m8 21 3-6 3 2 1-6-4-1-3 3m7 2 3 1"/>',
};

export function icon(name, { label } = {}) {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  const filled = name === "play" ? ' style="fill:currentColor"' : "";
  return `<svg class="icon icon--${name}" viewBox="0 0 24 24" ${a11y}${filled}>${paths[name]}</svg>`;
}

/** The JumpLab mark: a takeoff dot, the flight arc and a landing tick. */
export const logoMark = `
<svg viewBox="0 0 34 34" aria-hidden="true" focusable="false">
  <rect width="34" height="34" rx="2" fill="#a3262a"/>
  <path d="M6 25 C 11 8, 21 8, 28 25" fill="none" stroke="#f3f1ec" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.1 5.2"/>
  <circle cx="6" cy="25" r="2.6" fill="#f3f1ec"/>
  <path d="M25 27.5h6" stroke="#f3f1ec" stroke-width="3" stroke-linecap="round"/>
</svg>`;
