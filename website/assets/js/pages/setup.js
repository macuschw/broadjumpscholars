// Setup checklist: count ready items and remember them in this browser (best effort).
import { store } from "../lib/dom.js";

const KEY = "jumplab.setup-checklist";
const boxes = [...document.querySelectorAll("#checklist input[type=checkbox]")];
const count = document.getElementById("check-count");
document.getElementById("check-total").textContent = boxes.length;

const saved = store.get(KEY, {});
boxes.forEach((b) => { b.checked = Boolean(saved[b.name]); });

function update() {
  count.textContent = boxes.filter((b) => b.checked).length;
  store.set(KEY, Object.fromEntries(boxes.map((b) => [b.name, b.checked])));
}
boxes.forEach((b) => b.addEventListener("change", update));
document.getElementById("check-reset").addEventListener("click", () => { boxes.forEach((b) => { b.checked = false; }); update(); });
update();
