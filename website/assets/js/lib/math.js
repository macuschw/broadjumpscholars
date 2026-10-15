// Mathematical typesetting: every element with data-tex is rendered from its LaTeX source by
// KaTeX (the look of a LaTeX / Overleaf document). data-display marks a displayed equation;
// without it the formula sits inline in the text. The plain HTML already inside each element
// is the fallback, so if KaTeX can't load the page still shows every formula.
// Loaded with blocking="render", so formulas never visibly change shape after the page appears.
// A formula with a number in it can give its imperial version in data-tex-imperial; it is set
// again whenever the units change.
import katex from "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.mjs";
import { isImperial, onUnitsChange } from "./units.js";

function typeset(el) {
  const target = el.querySelector(":scope > .formula__body") || el;
  const tex = isImperial() && el.dataset.texImperial ? el.dataset.texImperial : el.dataset.tex;
  try {
    katex.render(tex, target, { displayMode: el.hasAttribute("data-display"), throwOnError: true });
    el.classList.add("is-typeset");
  } catch {
    // leave the HTML fallback in place for this one formula
  }
}
document.querySelectorAll("[data-tex]").forEach(typeset);
onUnitsChange(() => document.querySelectorAll("[data-tex-imperial].is-typeset").forEach(typeset));
