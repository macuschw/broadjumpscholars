// "My jumps": every real jump analyzed on the Analyze page, kept in this browser (IndexedDB) so the
// visitor can open it again on a later visit. Nothing leaves the browser: no account, no server.
// Each jump is stored as its results bundle (the same file "Download results" saves), plus a short
// summary for the list. The video is NOT kept (too big for browser storage): a reopened jump shows
// the skeleton on its own until the visitor adds the video back.
// Storage can be missing or refuse to work (private windows, blocked site data, school policies):
// every call then resolves quietly to "nothing saved", and the page works exactly as before.
const DB = "jumplab", VERSION = 1, LIST = "jumps", BUNDLES = "bundles";
export const MAX_SAVED = 100;                                   // oldest are dropped past this

let opening = null;
function db() {
  opening ??= new Promise((resolve) => {
    try {
      if (!("indexedDB" in window)) return resolve(null);
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(LIST)) d.createObjectStore(LIST, { keyPath: "id" });
        if (!d.objectStoreNames.contains(BUNDLES)) d.createObjectStore(BUNDLES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

/** Run fn(stores) in one transaction; resolves to fn's result once it has committed, or `fallback`. */
async function tx(mode, fn, fallback) {
  const d = await db();
  if (!d) return fallback;
  return new Promise((resolve) => {
    try {
      const t = d.transaction([LIST, BUNDLES], mode);
      let out = fallback;
      Promise.resolve(fn({ list: t.objectStore(LIST), bundles: t.objectStore(BUNDLES) })).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = t.onabort = () => resolve(fallback);
    } catch { resolve(fallback); }
  });
}
const done = (req) => new Promise((resolve) => { req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(undefined); });

/** Same jump, same analysis (opening a results file twice shouldn't list it twice). */
function fingerprint(b) {
  const r = b.results || {};
  return [b.name, r.events?.takeoff?.frame, r.events?.landing?.frame, r.scale_m_per_px ?? "none",
    r.distance?.jump_distance_m ?? r.distance?.jump_distance_m_gravity_scale ?? ""].join("|");
}

/** The list entry for a bundle: what the "My jumps" table shows without loading the whole file. */
function summary(b, id, savedAt) {
  const r = b.results || {}, d = r.distance || {}, warnings = b.warnings || r.warnings || [];
  return {
    id, savedAt, key: fingerprint(b), name: b.name || r.video || "Your jump",
    distance: d.jump_distance_m ?? d.jump_distance_m_gravity_scale ?? null,
    calibrated: r.scale_m_per_px != null,
    serious: warnings.filter((w) => w.severity === "serious").length,
    caution: warnings.filter((w) => w.severity === "caution").length,
  };
}

/** Saved jumps, newest first ([] if storage isn't available). */
export async function listJumps() {
  const all = await tx("readonly", ({ list }) => done(list.getAll()), []);
  return (all || []).sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Keep a bundle. Returns its id, or null if it couldn't be saved. Saving the same analysis again
 * (same jump, same scale) returns the existing id instead of adding a copy.
 */
export async function saveJump(bundle) {
  const key = fingerprint(bundle);
  const existing = (await listJumps()).find((j) => j.key === key);
  if (existing) return existing.id;
  const id = `jump-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const ok = await tx("readwrite", ({ list, bundles }) => {
    list.put(summary(bundle, id, Date.now()));
    bundles.put(bundle, id);
    return true;
  }, false);
  if (!ok) return null;
  const all = await listJumps();
  if (all.length > MAX_SAVED) await removeJumps(all.slice(MAX_SAVED).map((j) => j.id));
  return id;
}

/** The full bundle for a saved jump, or null. */
export async function loadJump(id) {
  return (await tx("readonly", ({ bundles }) => done(bundles.get(id)), null)) ?? null;
}

export async function removeJumps(ids) {
  return tx("readwrite", ({ list, bundles }) => { ids.forEach((id) => { list.delete(id); bundles.delete(id); }); return true; }, false);
}

export async function clearJumps() {
  return tx("readwrite", ({ list, bundles }) => { list.clear(); bundles.clear(); return true; }, false);
}
