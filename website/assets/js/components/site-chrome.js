// Persistent header and footer, shared by every page:
//   <jl-header current="metrics"></jl-header>   <jl-footer></jl-footer>
import { icon, logoMark } from "./icons.js";
import { getUnits, onUnitsChange, setUnits } from "../lib/units.js";

export const ROUTES = [
  { id: "how", href: "how-it-works.html", label: "How it works" },
  { id: "metrics", href: "metrics.html", label: "Metrics" },
  { id: "setup", href: "setup.html", label: "Setup" },
  { id: "science", href: "science.html", label: "Science" },
  { id: "about", href: "about.html", label: "About" },
];

class JlHeader extends HTMLElement {
  connectedCallback() {
    const current = this.getAttribute("current");
    const isDemo = current === "demo";
    const link = (r) => `<li><a class="nav-link" href="${r.href}"${r.id === current ? ' aria-current="page"' : ""}>${r.label}</a></li>`;
    this.innerHTML = `
      <header class="site-header">
        <div class="container site-header__inner">
          <a class="brand" href="index.html"${current === "home" ? ' aria-current="page"' : ""}>
            ${logoMark}<span>JumpLab</span><span class="brand__sub">working name</span>
          </a>
          <nav class="site-nav" id="site-nav" aria-label="Main">
            <ul class="nav-list">
              ${ROUTES.map(link).join("")}
              <li class="nav-item--units">
                <div class="units-switch" role="group" aria-label="Units">
                  <span class="units-switch__label" aria-hidden="true">Units</span>
                  <button type="button" class="units-switch__btn" data-units="metric" aria-label="m (metres)" title="Metric: metres">m</button>
                  <button type="button" class="units-switch__btn" data-units="imperial" aria-label="ft (feet and inches)" title="Imperial: feet and inches">ft</button>
                </div>
              </li>
              <li class="nav-item--cta"><a class="btn btn--primary" href="demo.html"${isDemo ? ' aria-current="page"' : ""}>Open demo ${icon("arrow")}</a></li>
            </ul>
          </nav>
          <a class="btn btn--primary btn--nav" href="demo.html"${isDemo ? ' aria-current="page"' : ""}>Open demo</a>
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">
            ${icon("menu")}<span>Menu</span>
          </button>
        </div>
      </header>`;

    // Units switch: every number on the page redraws in the chosen units, and the choice is remembered
    const unitButtons = [...this.querySelectorAll(".units-switch__btn")];
    const showUnits = (units) => unitButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.units === units)));
    unitButtons.forEach((b) => b.addEventListener("click", () => setUnits(b.dataset.units)));
    showUnits(getUnits());
    onUnitsChange(showUnits);

    const toggle = this.querySelector(".nav-toggle");
    const nav = this.querySelector(".site-nav");
    const setOpen = (open) => {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.innerHTML = `${icon(open ? "close" : "menu")}<span>${open ? "Close" : "Menu"}</span>`;
    };
    toggle.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
    });
    // Tabbing out of the open menu closes it, so focus never lands on content hidden under it
    this.addEventListener("focusout", (e) => {
      if (nav.classList.contains("is-open") && e.relatedTarget && !this.contains(e.relatedTarget)) setOpen(false);
    });
    document.addEventListener("click", (e) => {
      // composedPath() is fixed when the click starts, so it still includes the header even
      // though the toggle swaps its own icon while handling the click
      if (nav.classList.contains("is-open") && !e.composedPath().includes(this)) setOpen(false);
    });
  }
}

class JlFooter extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <footer class="site-footer">
        <div class="container site-footer__inner">
          <p><strong style="color:var(--paper)">JumpLab</strong> (working name) · a student biomechanics project.
             The sample jump and figures on these pages are simulated demo data.</p>
          <nav aria-label="Footer">
            <ul>
              <li><a href="index.html">Home</a></li>
              ${ROUTES.map((r) => `<li><a href="${r.href}">${r.label}</a></li>`).join("")}
              <li><a href="demo.html">Demo</a></li>
            </ul>
          </nav>
        </div>
      </footer>`;
  }
}

customElements.define("jl-header", JlHeader);
customElements.define("jl-footer", JlFooter);
