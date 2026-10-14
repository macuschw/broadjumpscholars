// Tiny DOM helpers: build HTML/SVG elements without a framework.
export const SVG_NS = "http://www.w3.org/2000/svg";

function apply(node, attrs, children) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") node.setAttribute("class", v);
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const el = (tag, attrs = {}, ...children) => apply(document.createElement(tag), attrs, children);
export const svg = (tag, attrs = {}, ...children) => apply(document.createElementNS(SVG_NS, tag), attrs, children);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Format a number with fixed decimals (and a real minus sign). */
export const fmt = (n, d = 2) => (n < 0 ? "−" : "") + Math.abs(n).toFixed(d);

/** localStorage that never throws (private mode, blocked storage). */
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
};
