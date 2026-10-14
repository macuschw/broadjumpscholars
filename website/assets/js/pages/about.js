// About: fill in the audience icons.
import { icon } from "../components/icons.js";

document.querySelectorAll("[data-icon]").forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
