// Mathematical typesetting: every element with data-tex is rendered from its LaTeX source by
// KaTeX (the look of a LaTeX / Overleaf document). data-display marks a displayed equation;
// without it the formula sits inline in the text. The plain HTML already inside each element
// is the fallback, so if KaTeX can't load the page still shows every formula.
// Loaded with blocking="render", so formulas never visibly change shape after the page appears.
import katex from "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.mjs";

for (const el of document.querySelectorAll("[data-tex]")) {
  const target = el.querySelector(":scope > .formula__body") || el;
  try {
    katex.render(el.dataset.tex, target, { displayMode: el.hasAttribute("data-display"), throwOnError: true });
    el.classList.add("is-typeset");
  } catch {
    // leave the HTML fallback in place for this one formula
  }
}
