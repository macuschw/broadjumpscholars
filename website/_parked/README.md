# Parked pages

Pages taken off the site for now. Nothing here is linked from the site.

## Accuracy (`accuracy.html`)

The placeholder validation table and the known-limitations list. To bring it back:

1. Move `accuracy.html` back to the site root and `accuracy.js` back to `assets/js/pages/`.
2. Paste `accuracy.css` back into `assets/css/pages.css` (above the About section).
3. Add the route back in `assets/js/components/site-chrome.js`:
   `{ id: "accuracy", href: "accuracy.html", label: "Accuracy" },` (after Science).
4. Optionally restore the link in the About page FAQ ("How accurate is it?").

The table's numbers still come from `VALIDATION_PLACEHOLDER` in `assets/js/data/mock-data.js`.
