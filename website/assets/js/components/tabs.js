// WAI-ARIA tabs: Left/Right/Home/End move between tabs; the selected tab is the only one in
// the tab order. onChange(id) fires when the visible panel changes. A single underline
// slides to the selected tab.
export function initTabs(tablist, { onChange } = {}) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const bar = document.createElement("span");
  bar.className = "tab-indicator";
  bar.setAttribute("aria-hidden", "true");
  tablist.append(bar);
  tablist.classList.add("has-indicator");
  let current = null, placed = false;
  const place = () => {
    if (!current || !current.offsetWidth) return;              // hidden: placed again when shown
    bar.style.transform = `translateX(${current.offsetLeft}px) scaleX(${current.offsetWidth})`;
    if (!placed) {                                             // first placement: no slide in from the edge
      placed = true;
      bar.getBoundingClientRect();
      bar.classList.add("is-ready");
    }
  };

  const select = (tab, focus = true) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    current = tab;
    place();
    if (focus) tab.focus();
    onChange?.(tab.dataset.tab);
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t, false));
    t.addEventListener("keydown", (e) => {
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (next == null) return;
      e.preventDefault();
      select(tabs[(next + tabs.length) % tabs.length]);
    });
  });
  select(tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0], false);

  // Keep the underline under its tab when fonts load, the layout changes or the tabs appear
  if ("ResizeObserver" in window) new ResizeObserver(place).observe(tablist);
  document.fonts?.ready.then(place);
  return { select: (id) => select(tabs.find((t) => t.dataset.tab === id), false) };
}
