// How it works: fill in the step icons.
import { icon } from "../components/icons.js";

document.querySelectorAll("[data-icon]").forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
