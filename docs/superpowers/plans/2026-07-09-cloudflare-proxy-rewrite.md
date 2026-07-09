# Cloudflare Proxy Rewrite + Satellite Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two Google AppEngine proxy branches with a single Cloudflare Worker in front of CIRA SLIDER, route all full-disk satellites through the SLIDER tile pipeline, let the website switch satellites via a URL param, and modernize the build to Vite.

**Architecture:** One Cloudflare Worker (`proxy/`) is an allowlisted CORS pass-through for `slider.cira.colostate.edu`. The website routes SLIDER requests through it; the extension hits SLIDER directly via `host_permissions`. DSCOVR/EPIC stays direct (already CORS). The native NICT Himawari code and the EUMETSAT scraper are removed. The client keeps a small static per-satellite config (tile size + max zoom).

**Tech Stack:** TypeScript, Vite (library mode) for the client bundle, Cloudflare Workers + Wrangler for the proxy, `d3-time-format`, `webextension-polyfill`.

**Reference spec:** `docs/superpowers/specs/2026-07-09-cloudflare-proxy-rewrite-design.md`

**No test framework exists in this repo.** Verification gates are: `npm run build` (Vite/tsc compile), `npm run lint` (eslint), `wrangler dev` + `curl` for the Worker, and manual browser load for the client. There is no unit-test runner; do not invent one.

---

## File structure

**Created:**
- `proxy/wrangler.toml` — Worker config (name `slider-proxy`).
- `proxy/src/worker.ts` — the CORS pass-through fetch handler.
- `proxy/package.json` — wrangler dev/deploy scripts.
- `proxy/README.md` — what it proxies, deploy steps, allowlist rationale.
- `proxy/.gitignore` — ignore `node_modules`, `.wrangler`.
- `vite.config.ts` — library-mode build producing `bundle.js` at repo root.

**Modified:**
- `package.json` — swap Rollup deps/scripts for Vite.
- `src/index.ts` — new satellite config, generalized SLIDER pipeline, removals, URL-param switching.
- `style.css` — consolidate SLIDER body classes into `.slider`.
- `options.html` — new satellite `<select>` list + description text.
- `options.js` — default `imageType` → `HIMAWARI_9`.
- `manifest.chrome.json` / `manifest.firefox.json` — host permissions.
- `README.md` — architecture, satellites, URL params, worker deploy, attribution.

**Deleted (from disk):** none. `rollup.config.js` is removed in Task 1.

---

## Task 1: Migrate build from Rollup to Vite (library mode) + yarn to npm

**Files:**
- Create: `vite.config.ts`
- Modify: `package.json`, `.github/workflows/push.yml`
- Delete: `rollup.config.js`, `yarn.lock`

This task also switches the package manager from **yarn to npm** (plain npm — no pnpm).
`npm install` in Step 1 generates `package-lock.json`; `yarn.lock` is removed and the CI
workflow + `bundle:src` script are updated to match.

- [ ] **Step 1: Install Vite, remove Rollup plugins**

Run:
```bash
npm install --save-dev vite@^6.0.0
npm uninstall rollup rollup-plugin-terser rollup-plugin-typescript2 @rollup/plugin-node-resolve
```
Expected: `vite` appears in `devDependencies`; the four rollup packages are gone. `typescript` and `web-ext-types` remain.

- [ ] **Step 2: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";

// Library-mode build: emit a single self-contained IIFE at the repo root as
// `bundle.js`, loaded by index.html/options via a plain <script>. This keeps the
// existing gh-pages-at-root layout and the zip packaging scripts unchanged.
export default defineConfig({
  build: {
    outDir: ".",
    emptyOutDir: false,
    sourcemap: true,
    minify: "terser",
    lib: {
      entry: "src/index.ts",
      name: "himawari",
      formats: ["iife"],
      fileName: () => "bundle.js",
    },
  },
});
```

- [ ] **Step 3: Update `package.json` scripts**

Replace the `build`, `watch`, and `start` scripts:
```json
    "build": "vite build",
    "watch": "vite build --watch",
    "dev": "vite",
    "start": "vite preview",
```
Also update the `bundle:src` script — it currently zips `rollup.config.js` (deleted)
and `yarn.lock` (deleted). Replace those two filenames with `vite.config.ts` and
`package-lock.json`:
```json
    "bundle:src": "zip -r source.zip src package.json lib index.html manifest*.json options.* vite.config.ts style.css tsconfig.json package-lock.json README.md",
```
Leave the other `bundle:*`, `lint`, `format`, and `postinstall` scripts unchanged.

- [ ] **Step 4: Install terser (Vite peer dep for `minify: "terser"`)**

Run:
```bash
npm install --save-dev terser
```
Expected: `terser` added to `devDependencies`.

- [ ] **Step 5: Delete the old Rollup config and yarn lockfile**

Run:
```bash
git rm rollup.config.js yarn.lock
```

- [ ] **Step 5b: Switch CI from yarn to npm**

Edit `.github/workflows/push.yml`. Change the Node cache from `yarn` to `npm`, and the
three yarn steps to npm equivalents:
- `cache: "yarn"` → `cache: "npm"`
- `run: yarn --frozen-lockfile` → `run: npm ci`
- `run: yarn lint` → `run: npm run lint`
- `run: yarn build` → `run: npm run build`

Verify no `yarn` references remain in the workflow:
```bash
grep -n yarn .github/workflows/push.yml || echo "clean"
```
Expected: `clean`.

- [ ] **Step 6: Build and verify output**

Run:
```bash
npm run build
```
Expected: exits 0 and writes `./bundle.js` and `./bundle.js.map`. Confirm the file is a single IIFE:
```bash
head -c 40 bundle.js
```
Expected: starts with something like `(function()` or `var himawari=` (an IIFE, not an ES `import`/`export`).

- [ ] **Step 7: Lint**

Run:
```bash
npm run lint
```
Expected: exits 0 (no errors). `src/index.ts` is unchanged in this task, so this must pass.

- [ ] **Step 8: Manual load check**

Run `npm run dev`, open the printed local URL, and confirm the current Himawari-9 image renders (this exercises the existing, still-unchanged source through Vite). Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add vite.config.ts package.json package-lock.json .github/workflows/push.yml
git commit -m "build: migrate from Rollup to Vite and yarn to npm"
```
(`rollup.config.js` and `yarn.lock` were already staged for deletion in Step 5.)

---

## Task 2: Add the Cloudflare Worker (`proxy/`)

**Files:**
- Create: `proxy/wrangler.toml`, `proxy/src/worker.ts`, `proxy/package.json`, `proxy/README.md`, `proxy/.gitignore`

- [ ] **Step 1: Create `proxy/wrangler.toml`**

```toml
name = "slider-proxy"
main = "src/worker.ts"
compatibility_date = "2026-07-01"

# Deployed as https://slider-proxy.domoritz.workers.dev
workers_dev = true
```

- [ ] **Step 2: Create `proxy/src/worker.ts`**

```ts
// CORS pass-through for CIRA SLIDER (slider.cira.colostate.edu).
//
// Contract: GET /?<url-encoded slider URL>
// The website calls this because SLIDER sends no CORS headers. The extension does
// NOT use this worker (it fetches SLIDER directly via host_permissions).
//
// Only SLIDER hosts are allowed, so this cannot be abused as an open proxy.

const ALLOWED_HOSTS = new Set([
  "slider.cira.colostate.edu",
  "rammb-slider.cira.colostate.edu",
]);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function withCors(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(body, { ...init, headers });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(null, { status: 204 });
    }
    if (request.method !== "GET") {
      return withCors("Method not allowed", { status: 405 });
    }

    const requestUrl = new URL(request.url);
    // Everything after the leading "?" is the (url-encoded) target URL.
    const target = decodeURIComponent(requestUrl.search.slice(1));
    if (!target) {
      return withCors("Usage: /?<url-encoded slider URL>", { status: 400 });
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      return withCors("Invalid URL", { status: 400 });
    }

    if (targetUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(targetUrl.hostname)) {
      return withCors("Forbidden host", { status: 403 });
    }

    // Tiles are immutable and cache-friendly; latest_times.json changes often.
    const isJson = targetUrl.pathname.endsWith(".json");
    const cacheTtl = isJson ? 60 : 604800;

    const upstream = await fetch(targetUrl.toString(), {
      cf: { cacheEverything: true, cacheTtl },
    });

    const response = withCors(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
    response.headers.set(
      "Cache-Control",
      isJson ? "public, max-age=60" : "public, max-age=604800, immutable",
    );
    return response;
  },
};
```

- [ ] **Step 3: Create `proxy/package.json`**

```json
{
  "name": "slider-proxy",
  "version": "1.0.0",
  "private": true,
  "description": "CORS pass-through proxy for CIRA SLIDER imagery.",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240909.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 4: Create `proxy/.gitignore`**

```
node_modules/
.wrangler/
```

- [ ] **Step 5: Create `proxy/README.md`**

````markdown
# slider-proxy

A Cloudflare Worker that CORS-proxies [CIRA SLIDER](https://slider.cira.colostate.edu/)
imagery for the Himawari/Satellite new-tab website. SLIDER sends no CORS headers, so
the browser cannot fetch its tiles/JSON directly; this worker adds
`Access-Control-Allow-Origin: *`.

It replaces the old Google AppEngine proxies (`himawari-8.appspot.com` and
`meteosat-url.appspot.com`) — everything the website needs now comes from SLIDER.

## Contract

`GET /?<url-encoded slider URL>` — only `slider.cira.colostate.edu` and
`rammb-slider.cira.colostate.edu` are allowed (not an open proxy). Tiles are cached
for 7 days (immutable); `latest_times.json` for 60s.

The **browser extension** does not use this worker — it fetches SLIDER directly via
`host_permissions`. Only the website proxies through here.

## Develop / deploy

```bash
cd proxy
npm install
npm run dev      # local worker at http://localhost:8787
npm run deploy   # deploys to slider-proxy.domoritz.workers.dev
```

## Satellite config note

The client's per-satellite `tileSize`/`maxLevel` table (in `src/index.ts`) is derived
from SLIDER's catalog `https://slider.cira.colostate.edu/js/define-products---rammb-slider.js`:
for each satellite with a `full_disk` sector, `tileSize = sectors.full_disk.tile_size`
and `maxLevel = sectors.full_disk.max_zoom_level − products.geocolor.zoom_level_adjust`.
Regenerate it if CIRA adds/removes satellites.
````

- [ ] **Step 6: Install deps and run the worker**

Run:
```bash
cd proxy && npm install && npx wrangler dev --port 8787 &
sleep 5
```
Expected: wrangler prints "Ready on http://localhost:8787".

- [ ] **Step 7: Verify — allowlisted JSON returns CORS**

Run:
```bash
curl -s -D - -o /dev/null "http://localhost:8787/?$(node -e 'process.stdout.write(encodeURIComponent("https://slider.cira.colostate.edu/data/json/goes-19/full_disk/geocolor/latest_times.json"))')" | grep -iE "HTTP/|access-control-allow-origin|content-type"
```
Expected: `HTTP/1.1 200`, `access-control-allow-origin: *`, `content-type: application/json`.

- [ ] **Step 8: Verify — forbidden host is rejected**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8787/?$(node -e 'process.stdout.write(encodeURIComponent("https://example.com/"))')"
```
Expected: `403`.

- [ ] **Step 9: Verify — OPTIONS preflight**

Run:
```bash
curl -s -X OPTIONS -D - -o /dev/null "http://localhost:8787/" | grep -iE "HTTP/|access-control-allow-origin"
```
Expected: `HTTP/1.1 204` and `access-control-allow-origin: *`. Then stop the worker: `kill %1`.

- [ ] **Step 10: Commit**

```bash
git add proxy
git commit -m "feat(proxy): add slider-proxy Cloudflare Worker"
```

---

## Task 3: Rewrite the client SLIDER pipeline + satellite config (`src/index.ts`)

This task replaces the image-type constants, generalizes the SLIDER tile pipeline to a
per-satellite config, removes the native Himawari + EUMETSAT code, and adds URL-param
switching for the website. Do it as one cohesive edit, then build + lint + load.

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace the constants + image types block (lines 3–65)**

Replace everything from `// base url for images` through the `DEFAULT_OPTIONS` object with:

```ts
// base urls
const DSCOVR_BASE_URL = "https://epic.gsfc.nasa.gov/";
const SLIDER_BASE_URL = "https://slider.cira.colostate.edu/data/";

// links to online image explorers
const DSCOVR_EXPLORER = "https://epic.gsfc.nasa.gov";
const DSCOVR_EXPLORER_ENHANCED = DSCOVR_EXPLORER + "/enhanced";
const SLIDER_EXPLORER = "https://rammb-slider.cira.colostate.edu/";

// image types
const DSCOVR_EPIC = "EPIC";
const DSCOVR_EPIC_ENHANCED = "EPIC_ENHANCED";
const HIMAWARI_9 = "HIMAWARI_9";
const GOES_EAST = "GOES_EAST";
const GOES_WEST = "GOES_WEST";
const METEOSAT = "METEOSAT";
const METEOSAT_IODC = "METEOSAT_IODC";
const MTG = "MTG";
const GK2A = "GK2A";

type ImageType =
  | typeof DSCOVR_EPIC | typeof DSCOVR_EPIC_ENHANCED
  | typeof HIMAWARI_9 | typeof GOES_EAST | typeof GOES_WEST
  | typeof METEOSAT | typeof METEOSAT_IODC | typeof MTG | typeof GK2A;

// Per-satellite SLIDER config. tileSize and maxLevel come from SLIDER's catalog
// (https://slider.cira.colostate.edu/js/define-products---rammb-slider.js):
//   tileSize = sectors.full_disk.tile_size
//   maxLevel = sectors.full_disk.max_zoom_level − products.geocolor.zoom_level_adjust
// Regenerate if CIRA adds/removes satellites. Product is always "geocolor" (clean
// imagery — no gridlines/borders; those are separate overlay layers we never fetch).
interface SliderSat {
  path: string;      // SLIDER satellite id used in URLs
  tileSize: number;  // native pixel size of one tile
  maxLevel: number;  // highest usable geocolor zoom level
  title: string;
  urlParam: string;  // website ?satellite= key
}

const SLIDER_SATS: Record<string, SliderSat> = {
  [HIMAWARI_9]:    { path: "himawari",      tileSize: 688, maxLevel: 4, title: "Himawari-9",        urlParam: "himawari" },
  [GOES_EAST]:     { path: "goes-19",       tileSize: 678, maxLevel: 4, title: "GOES-East",         urlParam: "goes-east" },
  [GOES_WEST]:     { path: "goes-18",       tileSize: 678, maxLevel: 4, title: "GOES-West",         urlParam: "goes-west" },
  [METEOSAT]:      { path: "meteosat-0deg", tileSize: 464, maxLevel: 3, title: "Meteosat 0°",       urlParam: "meteosat" },
  [METEOSAT_IODC]: { path: "meteosat-9",    tileSize: 464, maxLevel: 3, title: "Meteosat IODC",     urlParam: "meteosat-iodc" },
  [MTG]:           { path: "meteosat-12",   tileSize: 696, maxLevel: 4, title: "Meteosat-12 (MTG)", urlParam: "mtg" },
  [GK2A]:          { path: "gk2a",          tileSize: 688, maxLevel: 4, title: "GK2A",              urlParam: "gk2a" },
};

const SLIDER_BLOCK_SIZES = [1, 2, 4, 8, 16];  // tiles per axis at levels 0..4

const DSCOVR_WIDTH = 2048;

const IMAGE_QUALITY = 0.95;
const RELOAD_INTERVAL = 1 * 60 * 1000;  // 1 minute
const RELOAD_TIME_INTERVAL = 10 * 1000;  // 10 seconds

// local storage keys
const IMAGE_DATA_KEY = "imageData";
const CACHED_DATE_KEY = "cachedDate";
const CACHED_IMAGE_TYPE_KEY = "cachedImageType";

// unknown date
const UNKNOWN: Date = null;

const isExtension = window['browser'] && !!browser.storage;

const DEFAULT_OPTIONS: {animated: boolean; imageType: ImageType} = {
  animated: false,
  imageType: HIMAWARI_9,
};
```

- [ ] **Step 2: Delete `himawariURLs` and replace `sliderURLs` (old lines 84–174)**

Delete the entire `himawariURLs` function (its doc comment too) and replace `sliderURLs`
with a version driven by the satellite config:

```ts
function sliderURLs(sat: SliderSat, date: Date, blocks: number, level: number) {
  const formattedDate = utcFormat("%Y/%m/%d")(date);
  const formattedDateTime = utcFormat("%Y%m%d%H%M%S")(date);

  const tilesURL = `${SLIDER_BASE_URL}imagery/${formattedDate}/${sat.path}---full_disk/geocolor/${formattedDateTime}/`;
  const tiles: Tile[] = [];

  for (let y = 0; y < blocks; y++) {
    for (let x = 0; x < blocks; x++) {
      const url = `${tilesURL}${pad(level, 2)}/${pad(y, 3)}_${pad(x, 3)}.png`;
      tiles.push({ url, x, y });
    }
  }

  return { blocks, date, tiles };
}
```

- [ ] **Step 3: Delete `getLatestHimawariDate` and rewrite `getLatestSliderDate` (old lines 176–224)**

Delete `getLatestHimawariDate` entirely. Keep `getLatestDscovrDate` unchanged. Replace
`getLatestSliderDate` (which is below `sliderProxy`) with:

```ts
async function getLatestSliderDate(sat: SliderSat) {
  const raw = await fetch(sliderProxy(`${SLIDER_BASE_URL}json/${sat.path}/full_disk/geocolor/latest_times.json`));
  const data: { timestamps_int: number[] } = await raw.json();

  // timestamps_int are integers, newest first; stringify for parsing.
  return utcParse("%Y%m%d%H%M%S")(String(data.timestamps_int[0]));
}
```

Keep `sliderProxy` exactly as-is (still points at `https://slider-proxy.domoritz.workers.dev/`).

- [ ] **Step 4: Delete `getLatestMeteosatDate` (old lines 226–234)**

Delete the whole `getLatestMeteosatDate` function.

- [ ] **Step 5: Clamp zoom to the satellite's max level in `getOptimalNumberOfBlocks`**

`getOptimalNumberOfBlocks` stays as-is (it already takes a `sizes` array). The caller
will pass a sliced array. No change here — confirm it reads:

```ts
function getOptimalNumberOfBlocks(width: number, sizes: number[]): {blocks: number; level: number} {
```

- [ ] **Step 6: Simplify `setBodyClass` to `slider` / `dscovr`**

Replace the whole `setBodyClass` function with:

```ts
/*
 * Set the right class on the body so that we can size the canvas via CSS.
 */
function setBodyClass(imageType: ImageType) {
  document.body.classList.remove("slider");
  document.body.classList.remove("dscovr");

  if (imageType === DSCOVR_EPIC || imageType === DSCOVR_EPIC_ENHANCED) {
    document.body.classList.add("dscovr");
  } else {
    document.body.classList.add("slider");
  }
}
```

- [ ] **Step 7: Delete `setHimawariImages` (old lines 358–421)**

Delete the entire `setHimawariImages` function. `storeCanvas` (above it) and
`setDscovrImage` (below it) stay unchanged.

- [ ] **Step 8: Rewrite `setSliderImages` to take the satellite config**

Replace `setSliderImages` with a version keyed on `sat.tileSize` and clamped zoom:

```ts
function setSliderImages(date: Date, sat: SliderSat, imageType: ImageType) {
  // no need to set images if we have up to date images and the type has not changed
  if (loadedDate && date.getTime() === loadedDate.getTime() && loadedType === imageType) {
    return;
  }

  // if we haven't loaded images before, we want to show progress
  const initialLoad = !localStorage.getItem(CACHED_DATE_KEY);

  if (initialLoad) {
    updateStateAndUI(date, imageType);
  }

  // clamp zoom to what this satellite's geocolor product actually has
  const sizes = SLIDER_BLOCK_SIZES.slice(0, sat.maxLevel + 1);
  const { blocks, level } = getOptimalNumberOfBlocks(sat.tileSize, sizes);
  const result = sliderURLs(sat, date, blocks, level);

  const pixels = result.blocks * sat.tileSize;

  const canvas = initialLoad ? document.getElementById("output") as HTMLCanvasElement : document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.canvas.width = pixels;
  ctx.canvas.height = pixels;

  function addImage(tile: Tile) {
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.setAttribute("crossOrigin", "anonymous");
      img.onload = () => {
        ctx.drawImage(img, tile.x * sat.tileSize, tile.y * sat.tileSize, sat.tileSize, sat.tileSize);
        resolve();
      };
      img.src = sliderProxy(tile.url);
    });
  }

  Promise.all(result.tiles.map(tile => addImage(tile)))
    .catch(error => { throw error; })
    .then(() => {
      if (!initialLoad) {
        const output = document.getElementById("output") as HTMLCanvasElement;
        const outCtx = output.getContext("2d");
        outCtx.canvas.width = pixels;
        outCtx.canvas.height = pixels;
        outCtx.drawImage(canvas, 0, 0);
      }
      updateStateAndUI(date, imageType);
      storeCanvas(date, imageType);
    });
}
```

- [ ] **Step 9: Delete `setMeteosatImages` (old lines 528–567)**

Delete the entire `setMeteosatImages` function.

- [ ] **Step 10: Add the URL-param helper and rewrite `setLatestImage`**

Add this helper just above `setLatestImage`:

```ts
/** Resolve the satellite for the website from the ?satellite= URL param. */
function getSatelliteFromURL(): ImageType {
  const param = new URLSearchParams(window.location.search).get("satellite");
  if (param) {
    if (param === "epic") { return DSCOVR_EPIC; }
    if (param === "epic-enhanced") { return DSCOVR_EPIC_ENHANCED; }
    for (const key of Object.keys(SLIDER_SATS)) {
      if (SLIDER_SATS[key].urlParam === param) { return key as ImageType; }
    }
  }
  return HIMAWARI_9;
}
```

Replace the whole `setLatestImage` function with:

```ts
/* Load latest image(s) date and images for that date */
async function setLatestImage() {
  if (!navigator.onLine) {
    return;
  }

  let imageType: ImageType;
  if (isExtension) {
    document.title = "New Tab";
    const options = await browser.storage.sync.get(DEFAULT_OPTIONS);
    imageType = options.imageType;
  } else {
    imageType = getSatelliteFromURL();
  }

  if (imageType === DSCOVR_EPIC || imageType === DSCOVR_EPIC_ENHANCED) {
    setDscovrImage(await getLatestDscovrDate(imageType), imageType);
    return;
  }

  // Any SLIDER satellite (falls back to Himawari-9 for unknown/legacy stored values).
  const sat = SLIDER_SATS[imageType] || SLIDER_SATS[HIMAWARI_9];
  const resolvedType = SLIDER_SATS[imageType] ? imageType : HIMAWARI_9;
  setSliderImages(await getLatestSliderDate(sat), sat, resolvedType);
}
```

- [ ] **Step 11: Simplify the `explore` click handler (old lines 676–705)**

Replace the `switch (loadedType)` body inside the `explore` click listener with:

```ts
document.getElementById("explore").addEventListener("click", () => {
  switch (loadedType) {
    case DSCOVR_EPIC:
      window.open(DSCOVR_EXPLORER, "_self");
      break;
    case DSCOVR_EPIC_ENHANCED:
      window.open(DSCOVR_EXPLORER_ENHANCED, "_self");
      break;
    default:
      // all SLIDER satellites
      window.open(SLIDER_EXPLORER, "_self");
      break;
  }
});
```

- [ ] **Step 12: Build**

Run:
```bash
npm run build
```
Expected: exits 0, no TypeScript errors, writes `./bundle.js`. If tsc complains about
unused symbols, ensure every removed constant/function is fully deleted and no stale
references remain (e.g. `HIMAWARI_WIDTH`, `INFRARED`, `GOES_16`, `setMeteosatImages`).

- [ ] **Step 13: Lint**

Run:
```bash
npm run lint
```
Expected: exits 0.

- [ ] **Step 14: Manual load — website default + switching**

Run `npm run dev`, then:
- Open the base URL → confirm a clean Himawari-9 full disk (no gridlines).
- Open `?satellite=goes-east` → GOES-East renders.
- Open `?satellite=meteosat` → Meteosat 0° renders (may be a few hours stale — that's expected).
- Open `?satellite=meteosat-iodc` → renders with no missing/404 tiles (confirms level clamp to 3).
- Open `?satellite=epic` → DSCOVR loads directly (no proxy).
Stop the dev server.

- [ ] **Step 15: Commit**

```bash
git add src/index.ts
git commit -m "feat: route all full-disk satellites through SLIDER; add website URL switching"
```

---

## Task 4: Consolidate SLIDER body classes in CSS (`style.css`)

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Replace the two `@media` orientation blocks (lines 46–88)**

Replace both orientation media-query blocks with `.slider` (matching the new body
class) plus `.dscovr`:

```css
/* Always keep the earth centered */
@media (orientation:landscape) {
  .slider #output {
    height: 90vh;
    width: 90vh;
  }

  .dscovr #output {
    height: 100vh;
    width: 100vh;
  }
}
@media screen and (orientation:portrait) {
  .slider #output {
    height: 90vw;
    width: 90vw;
  }

  .dscovr #output {
    height: 100vw;
    width: 100vw;
  }
}
```

- [ ] **Step 2: Verify visually**

Run `npm run dev`, open the site, confirm the disk is centered at ~90vh and the layout
is unchanged from before. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "style: consolidate SLIDER satellite body classes into .slider"
```

---

## Task 5: Update the options page (`options.html`, `options.js`)

**Files:**
- Modify: `options.html`, `options.js`

- [ ] **Step 1: Replace the `<select id="image">` options (lines 42–56)**

```html
    <select id="image">
      <option value="HIMAWARI_9">Himawari-9 (140.7°E)</option>
      <option value="GOES_EAST">GOES-East (75.2°W)</option>
      <option value="GOES_WEST">GOES-West (137°W)</option>
      <option value="METEOSAT">Meteosat 0°</option>
      <option value="METEOSAT_IODC">Meteosat IODC (45.5°E)</option>
      <option value="MTG">Meteosat-12 / MTG (0°)</option>
      <option value="GK2A">GK2A (128°E)</option>
      <option value="EPIC">DSCOVR EPIC</option>
      <option value="EPIC_ENHANCED">DSCOVR EPIC Enhanced</option>
    </select>
```

- [ ] **Step 2: Replace the `.desc` block (lines 57–75)**

```html
    <div class="desc">
      <p>
        Geostationary satellites — <a href="https://en.wikipedia.org/wiki/Himawari_(satellites)">Himawari-9</a> (Asia/Pacific),
        <a href="https://en.wikipedia.org/wiki/Geostationary_Operational_Environmental_Satellite">GOES-East/West</a> (Americas/Pacific),
        <a href="https://www.eumetsat.int/meteosat-second-generation">Meteosat</a> (Europe/Africa, 0° and Indian Ocean),
        <a href="https://www.eumetsat.int/meteosat-third-generation">MTG</a>, and
        <a href="https://en.wikipedia.org/wiki/GEO-KOMPSAT-2">GK2A</a> (Korea) —
        shown as clean GeoColor full-disk imagery (true color by day, infrared at night)
        via <a href="https://rammb-slider.cira.colostate.edu/">CIRA SLIDER</a>.
      </p><p>
        <a href="https://en.wikipedia.org/wiki/Deep_Space_Climate_Observatory#EPIC">DSCOVR EPIC</a>
        shows the whole sunlit Earth from ~1.5 million km away.
      </p>
    </div>
```

- [ ] **Step 3: Update the image-credit footer (lines 87–95)**

Replace the credit `<small>` with attribution SLIDER requires:

```html
  <p>
    <small>
      Imagery: NOAA / CIRA / RAMMB SLIDER,
      Japan Meteorological Agency (JMA),
      National Aeronautics and Space Administration (NASA),
      Korea Meteorological Administration (KMA).
      Meteosat imagery contains modified <span id="year"></span> EUMETSAT data.
    </small>
  </p>
```

- [ ] **Step 4: Update the default in `options.js` (line 23)**

Change:
```js
  const query = { imageType: "D531106", animated: false };
```
to:
```js
  const query = { imageType: "HIMAWARI_9", animated: false };
```

- [ ] **Step 5: Lint**

Run:
```bash
npm run lint
```
Expected: exits 0 (`options.js` is linted).

- [ ] **Step 6: Manual check (extension)**

Load the extension unpacked (Chrome: `chrome://extensions` → Load unpacked → repo root,
after `cp manifest.chrome.json manifest.json`). Open a new tab, open options, switch
between each satellite, and confirm each renders. Confirm SLIDER tiles are fetched
directly (DevTools Network shows `slider.cira.colostate.edu`, not the worker).

- [ ] **Step 7: Commit**

```bash
git add options.html options.js
git commit -m "feat(options): new satellite list and defaults"
```

---

## Task 6: Update host permissions (`manifest.chrome.json`, `manifest.firefox.json`)

**Files:**
- Modify: `manifest.chrome.json`, `manifest.firefox.json`

- [ ] **Step 1: Chrome — replace `host_permissions` (lines 14–19)**

```json
  "host_permissions": [
    "https://slider.cira.colostate.edu/",
    "https://rammb-slider.cira.colostate.edu/",
    "https://epic.gsfc.nasa.gov/"
  ],
```

- [ ] **Step 2: Firefox — replace the `permissions` array (lines 17–23)**

```json
  "permissions": [
    "storage",
    "https://slider.cira.colostate.edu/",
    "https://rammb-slider.cira.colostate.edu/",
    "https://epic.gsfc.nasa.gov/"
  ],
```

- [ ] **Step 3: Validate JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('manifest.chrome.json','utf8')); JSON.parse(require('fs').readFileSync('manifest.firefox.json','utf8')); console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add manifest.chrome.json manifest.firefox.json
git commit -m "chore: drop himawari8-dl host permission (SLIDER + EPIC only)"
```

---

## Task 7: Update the README (`README.md`)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the current README**

Run:
```bash
sed -n '1,80p' README.md
```
Note the existing structure so the edits fit the tone.

- [ ] **Step 2: Add/replace a "How it works" + "Satellites" + "Website" section**

Ensure the README documents (edit prose to match existing style):

- **Architecture:** the website and extension render full-disk satellite imagery from
  CIRA SLIDER; a single Cloudflare Worker (`proxy/`, deployed at
  `slider-proxy.domoritz.workers.dev`) adds CORS for the website; the extension fetches
  SLIDER directly via `host_permissions`; DSCOVR/EPIC is fetched directly.
- **Satellites:** Himawari-9, GOES-East, GOES-West, Meteosat 0°, Meteosat IODC,
  Meteosat-12 (MTG), GK2A, plus DSCOVR EPIC (natural + enhanced).
- **Website switching:** `?satellite=<key>` where key is one of `himawari` (default),
  `goes-east`, `goes-west`, `meteosat`, `meteosat-iodc`, `mtg`, `gk2a`, `epic`,
  `epic-enhanced`. Also **replace** the "can only switch in the extension" note
  (current README line 41) — the website now switches too.
- **Direct preview links:** add a "Try a specific satellite" list of deep links so each
  satellite is one click from the README (the base URL defaults to Himawari-9):

  ```markdown
  ## Try a specific satellite

  - [Himawari-9](https://domoritz.github.io/satellite-new-tab/?satellite=himawari)
  - [GOES-East](https://domoritz.github.io/satellite-new-tab/?satellite=goes-east)
  - [GOES-West](https://domoritz.github.io/satellite-new-tab/?satellite=goes-west)
  - [Meteosat 0°](https://domoritz.github.io/satellite-new-tab/?satellite=meteosat)
  - [Meteosat IODC](https://domoritz.github.io/satellite-new-tab/?satellite=meteosat-iodc)
  - [Meteosat-12 / MTG](https://domoritz.github.io/satellite-new-tab/?satellite=mtg)
  - [GK2A](https://domoritz.github.io/satellite-new-tab/?satellite=gk2a)
  - [DSCOVR EPIC](https://domoritz.github.io/satellite-new-tab/?satellite=epic)
  - [DSCOVR EPIC Enhanced](https://domoritz.github.io/satellite-new-tab/?satellite=epic-enhanced)
  ```
- **Proxy:** link to `proxy/README.md` and the `cd proxy && npm run deploy` step.
- **Attribution:** "Imagery: NOAA / CIRA / RAMMB SLIDER" and "Meteosat imagery contains
  modified EUMETSAT data".
- Remove any references to `himawari-8.appspot.com`, `meteosat-url.appspot.com`, the Go
  proxy, and native Himawari visible/infrared as the mechanism.
- **yarn → npm:** update the developer/release prose (current README lines 111 and 113):
  `yarn` → `npm install`, `yarn watch` → `npm run watch`, `yarn start` → `npm run dev`,
  `yarn bundle` → `npm run bundle`. Remove the yarnpkg.com link.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document SLIDER architecture, satellites, and URL switching"
```

---

## Task 8: Final verification + cleanup notes

**Files:** none (verification only)

- [ ] **Step 1: Full build + lint**

Run:
```bash
npm run build && npm run lint
```
Expected: both exit 0.

- [ ] **Step 2: Grep for dead references**

Run:
```bash
grep -rnE "appspot|himawari8-dl|INFRARED_FULL|D531106|GOES_16|GOES_17|meteosat-url|himawariURLs|setHimawariImages|setMeteosatImages|getLatestHimawariDate|getLatestMeteosatDate|yarn|rollup" src/index.ts options.html options.js manifest.chrome.json manifest.firefox.json README.md package.json .github/workflows/push.yml || echo "clean"
```
Expected: `clean` (no matches). Any hit is a leftover to remove.

- [ ] **Step 3: Record manual follow-ups (not automated)**

These are intentionally NOT done by this plan (remote/destructive, and nothing is
pushed). Note them for the maintainer:
- Deploy the worker: `cd proxy && npm run deploy`.
- Delete the remote `proxy` and `meteosat` git branches once the worker is live.
- Decommission the `himawari-8` and `meteosat-url` Google AppEngine apps.

- [ ] **Step 4: Confirm nothing is pushed**

Run:
```bash
git status && git log --oneline origin/gh-pages..HEAD
```
Expected: a clean tree and a list of the local-only commits from this plan (none pushed).

---

## Self-review notes

- **Spec coverage:** Worker (T2), SLIDER-unified pipeline for all full-disk sats (T3),
  DSCOVR direct (T3), URL-param switching (T3), retire native Himawari + EUMETSAT (T3),
  options/manifests/README (T4–T7), attribution (T4, T7), Vite build (T1), cleanup
  follow-ups (T8). All spec sections map to a task.
- **Legacy stored `imageType`:** old synced values (e.g. `D531106`, `GOES_16`) are not
  in `SLIDER_SATS`; `setLatestImage` falls back to Himawari-9, so upgrades don't break.
- **Level clamp:** Meteosat feeds (maxLevel 3) use `SLIDER_BLOCK_SIZES.slice(0, 4)`, so
  no level-4 tile is ever requested (fixes 404s).
