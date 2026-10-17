// Setup checklist: count ready items and remember them in this browser (best effort).
// With every item ticked, the count becomes "All 7 ready" and a "Ready to film" note appears.
import { store } from "../lib/dom.js";
import { icon } from "../components/icons.js";

const KEY = "jumplab.setup-checklist";
const boxes = [...document.querySelectorAll("#checklist input[type=checkbox]")];
const progress = document.getElementById("check-progress"), ready = document.getElementById("check-ready");
ready.querySelector("[data-icon]").innerHTML = icon("check");

const saved = store.get(KEY, {});
boxes.forEach((b) => { b.checked = Boolean(saved[b.name]); });

function update() {
  const n = boxes.filter((b) => b.checked).length, done = n === boxes.length;
  progress.classList.toggle("is-done", done);
  progress.innerHTML = done
    ? `<span class="setup__done">${icon("check")}All ${n} ready</span>`
    : `<span>${n}</span> of <span>${boxes.length}</span> ready`;
  ready.hidden = !done;
  store.set(KEY, Object.fromEntries(boxes.map((b) => [b.name, b.checked])));
}
boxes.forEach((b) => b.addEventListener("change", update));
document.getElementById("check-reset").addEventListener("click", () => { boxes.forEach((b) => { b.checked = false; }); update(); });
update();
